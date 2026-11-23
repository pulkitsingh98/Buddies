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

    // --- wellbeing (delivered by the first pet that is out) ---
    pub water_enabled: bool,
    pub water_every_min: u32,
    pub stretch_enabled: bool,
    pub stretch_every_min: u32,
    /// 20-20-20 eye breaks.
    pub eye_enabled: bool,
    pub eye_every_min: u32,
    /// No reminders or chit-chat between these local hours (start may be > end, wrapping midnight).
    pub quiet_start: u8,
    pub quiet_end: u8,
    pub focus_min: u32,
    pub break_min: u32,
    pub daily_message: bool,
    pub compliments: bool,
    pub mood_checkin: bool,

    // --- social ---
    /// Queue incoming visits/messages instead of showing them.
    pub do_not_disturb: bool,
    /// Let friends see today's mood check-in.
    pub share_mood: bool,
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
            water_enabled: true,
            water_every_min: 60,
            stretch_enabled: true,
            stretch_every_min: 45,
            eye_enabled: false,
            eye_every_min: 20,
            quiet_start: 22,
            quiet_end: 8,
            focus_min: 25,
            break_min: 5,
            daily_message: true,
            compliments: true,
            mood_checkin: true,
            do_not_disturb: false,
            share_mood: false,
        }
    }
}

impl Settings {
    fn clamped(mut self) -> Self {
        self.pet_size = self.pet_size.clamp(80, 320);
        self.sleep_after_min = self.sleep_after_min.clamp(1, 120);
        self.bedtime_hour = self.bedtime_hour.min(23);
        self.water_every_min = self.water_every_min.clamp(10, 240);
        self.stretch_every_min = self.stretch_every_min.clamp(10, 240);
        self.eye_every_min = self.eye_every_min.clamp(10, 120);
        self.quiet_start = self.quiet_start.min(23);
        self.quiet_end = self.quiet_end.min(23);
        self.focus_min = self.focus_min.clamp(5, 120);
        self.break_min = self.break_min.clamp(1, 60);
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

/// Opaque per-device wellbeing state (counters, next-reminder times, streaks) owned by the pet
/// page. Stored as JSON next to the settings.
fn wellbeing_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("wellbeing.json"))
}

#[tauri::command]
pub fn get_wellbeing_state(app: AppHandle) -> Result<serde_json::Value, String> {
    Ok(fs::read_to_string(wellbeing_path(&app)?)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null))
}

#[tauri::command]
pub fn set_wellbeing_state(app: AppHandle, state: serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(&state).map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 {
        return Err("wellbeing state too large".into());
    }
    write_atomic(&wellbeing_path(&app)?, &bytes)
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
