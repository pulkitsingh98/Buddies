//! Background update checks against GitHub Releases. When a new version is ready the first pet
//! asks the user; installing restarts the app.

use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

const FIRST_CHECK: Duration = Duration::from_secs(60);
const EVERY: Duration = Duration::from_secs(6 * 3600);

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            match app.updater() {
                Ok(updater) => match updater.check().await {
                    Ok(Some(update)) => {
                        log::info!("update available: {}", update.version);
                        let _ = app.emit("update://available", update.version.clone());
                    }
                    Ok(None) => {}
                    Err(e) => log::warn!("update check failed: {e}"),
                },
                Err(e) => log::warn!("updater unavailable: {e}"),
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// Downloads and installs the latest release, then restarts into it.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let Some(update) = update else {
        return Err("You're already up to date.".into());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
