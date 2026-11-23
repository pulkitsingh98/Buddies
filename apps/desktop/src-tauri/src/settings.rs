use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::pet_windows;

/// Local, per-device preferences. Persisted as JSON in the app config dir.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Pets that are "out" on the desktop.
    pub active_pets: Vec<String>,
    /// Global show/hide toggle from the tray.
    pub pets_visible: bool,
    /// Pet height in logical pixels.
    pub pet_size: u32,
    pub reduced_motion: bool,
    /// Minutes of user inactivity before pets fall asleep.
    pub sleep_after_min: u32,
    /// Local hour (0–23) after which pets get sleepy and nudge you to bed.
    pub bedtime_hour: u8,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            active_pets: Vec::new(),
            pets_visible: true,
            pet_size: 150,
            reduced_motion: false,
            sleep_after_min: 5,
            bedtime_hour: 23,
        }
    }
}

impl Settings {
    fn clamped(mut self) -> Self {
        self.pet_size = self.pet_size.clamp(80, 320);
        self.sleep_after_min = self.sleep_after_min.clamp(1, 120);
        self.bedtime_hour = self.bedtime_hour.min(23);
        self.active_pets.dedup();
        self
    }
}

pub struct SettingsState {
    path: PathBuf,
    inner: Mutex<Settings>,
}

impl SettingsState {
    pub fn load(path: PathBuf) -> Self {
        let inner = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
            .unwrap_or_default()
            .clamped();
        Self {
            path,
            inner: Mutex::new(inner),
        }
    }

    pub fn get(&self) -> Settings {
        self.inner.lock().expect("settings poisoned").clone()
    }

    /// Applies `f`, persists atomically, and returns the new settings.
    pub fn update(&self, f: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
        let mut guard = self.inner.lock().expect("settings poisoned");
        let mut next = guard.clone();
        f(&mut next);
        let next = next.clamped();
        write_atomic(
            &self.path,
            &serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?,
        )?;
        *guard = next.clone();
        Ok(next)
    }
}

pub fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Persists, notifies every window, and brings pet windows in line with the new settings.
pub fn apply(app: &AppHandle, f: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
    let next = app.state::<SettingsState>().update(f)?;
    let _ = app.emit("settings://changed", &next);
    pet_windows::reconcile(app);
    Ok(next)
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Settings {
    state.get()
}

/// Merges a partial JSON object into the settings.
#[tauri::command]
pub fn update_settings(app: AppHandle, patch: serde_json::Value) -> Result<Settings, String> {
    apply(&app, |s| {
        let mut value = serde_json::to_value(&*s).unwrap_or_default();
        if let (Some(obj), Some(patch)) = (value.as_object_mut(), patch.as_object()) {
            for (k, v) in patch {
                obj.insert(k.clone(), v.clone());
            }
        }
        if let Ok(next) = serde_json::from_value(value) {
            *s = next;
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_use_defaults_and_values_are_clamped() {
        let s: Settings = serde_json::from_str(r#"{"petSize": 9999}"#).unwrap();
        let s = s.clamped();
        assert_eq!(s.pet_size, 320);
        assert!(s.pets_visible);
        assert_eq!(s.bedtime_hour, 23);
    }

    #[test]
    fn update_persists_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let state = SettingsState::load(path.clone());
        state.update(|s| s.reduced_motion = true).unwrap();
        let reloaded = SettingsState::load(path);
        assert!(reloaded.get().reduced_motion);
    }
}
