//! On-demand download of the on-device background-removal model + ONNX Runtime wasm.
//! Files are mirrored on our own GitHub release and pinned by SHA-256.

use std::path::PathBuf;

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{ipc::Channel, ipc::Response, AppHandle, Manager};
use tokio::io::AsyncWriteExt;

const BASE_URL: &str = "https://github.com/pulkitsingh98/Buddies/releases/download/models-v1";

pub struct Asset {
    pub name: &'static str,
    pub sha256: &'static str,
    pub size: u64,
}

/// ISNet general-use (Apache-2.0) and onnxruntime-web 1.31.1 wasm (MIT).
/// The wasm version must match the `onnxruntime-web` npm version in package.json.
pub const ASSETS: &[Asset] = &[
    Asset {
        name: "isnet-general-use.onnx",
        sha256: "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a",
        size: 178_648_008,
    },
    Asset {
        name: "ort-wasm-simd-threaded-1.31.1.wasm",
        sha256: "4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d",
        size: 14_848_852,
    },
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub downloaded: u64,
    pub total: u64,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("models"))
}

fn asset(name: &str) -> Result<&'static Asset, String> {
    ASSETS
        .iter()
        .find(|a| a.name == name)
        .ok_or_else(|| format!("unknown asset {name}"))
}

fn is_present(dir: &std::path::Path, a: &Asset) -> bool {
    std::fs::metadata(dir.join(a.name)).is_ok_and(|m| m.len() == a.size)
}

/// Downloads any missing assets, reporting combined progress. Verified by hash before use.
#[tauri::command]
pub async fn ensure_segmentation_assets(
    app: AppHandle,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    let dir = models_dir(&app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let total: u64 = ASSETS.iter().map(|a| a.size).sum();
    let mut done: u64 = ASSETS
        .iter()
        .filter(|a| is_present(&dir, a))
        .map(|a| a.size)
        .sum();
    let _ = on_progress.send(Progress {
        downloaded: done,
        total,
    });

    let client = reqwest::Client::new();
    for a in ASSETS.iter().filter(|a| !is_present(&dir, a)) {
        let res = client
            .get(format!("{BASE_URL}/{}", a.name))
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("download failed: {e}"))?;
        let tmp = dir.join(format!("{}.part", a.name));
        let mut file = tokio::fs::File::create(&tmp)
            .await
            .map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut stream = res.bytes_stream();
        let mut last_report = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
            hasher.update(&chunk);
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            done += chunk.len() as u64;
            if done - last_report > 1 << 20 {
                last_report = done;
                let _ = on_progress.send(Progress {
                    downloaded: done,
                    total,
                });
            }
        }
        file.flush().await.map_err(|e| e.to_string())?;
        drop(file);
        let digest = format!("{:x}", hasher.finalize());
        if digest != a.sha256 {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(format!("{} failed integrity check", a.name));
        }
        tokio::fs::rename(&tmp, dir.join(a.name))
            .await
            .map_err(|e| e.to_string())?;
    }
    let _ = on_progress.send(Progress {
        downloaded: total,
        total,
    });
    Ok(())
}

/// Returns a downloaded asset as raw bytes.
#[tauri::command]
pub async fn read_segmentation_asset(app: AppHandle, name: String) -> Result<Response, String> {
    let a = asset(&name)?;
    let bytes = tokio::fs::read(models_dir(&app)?.join(a.name))
        .await
        .map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}
