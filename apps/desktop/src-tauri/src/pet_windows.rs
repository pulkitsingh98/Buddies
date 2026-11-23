//! One transparent, borderless, always-on-top window per pet that is "out".
//! Hidden pets have their window destroyed, not hidden, so they cost nothing.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{pets, settings::SettingsState};

pub const LABEL_PREFIX: &str = "pet-";

/// Runtime-only state that suppresses pets without touching saved settings.
#[derive(Default)]
pub struct PetRuntime {
    pub paused_until: Mutex<Option<Instant>>,
}

pub fn label(id: &str) -> String {
    format!("{LABEL_PREFIX}{id}")
}

/// Window size for a pet of the given height: room around it for hops, hearts and a speech bubble.
pub fn window_size(pet_size: u32) -> (f64, f64) {
    let s = pet_size as f64;
    ((s * 1.5).round(), (s * 1.8).round())
}

fn is_paused(app: &AppHandle) -> bool {
    let rt = app.state::<PetRuntime>();
    let mut guard = rt.paused_until.lock().expect("runtime poisoned");
    match *guard {
        Some(until) if Instant::now() < until => true,
        Some(_) => {
            *guard = None;
            false
        }
        None => false,
    }
}

/// Creates/destroys/resizes pet windows to match settings and pause state.
pub fn reconcile(app: &AppHandle) {
    let settings = app.state::<SettingsState>().get();
    let wanted: Vec<String> = if settings.pets_visible && !is_paused(app) {
        settings
            .active_pets
            .iter()
            .filter(|id| pets::exists(app, id))
            .map(|id| label(id))
            .collect()
    } else {
        Vec::new()
    };
    let (w, h) = window_size(settings.pet_size);

    for (lbl, win) in app.webview_windows() {
        if lbl.starts_with(LABEL_PREFIX) {
            if wanted.contains(&lbl) {
                let _ = win.set_size(tauri::LogicalSize::new(w, h));
            } else {
                let _ = win.destroy();
            }
        }
    }
    for lbl in wanted {
        if app.get_webview_window(&lbl).is_none() {
            if let Err(e) = spawn(app, &lbl, w, h) {
                log::error!("failed to create {lbl}: {e}");
            }
        }
    }
}

fn spawn(app: &AppHandle, lbl: &str, w: f64, h: f64) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, lbl, WebviewUrl::App("pet.html".into()))
        .title("DeskPals pet")
        .inner_size(w, h)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        // Never steal keyboard focus from whatever the user is doing, but still take clicks.
        .focused(false)
        .focusable(false)
        .accept_first_mouse(true)
        // Shown by the page after its first frame, to avoid a flash of an empty window.
        .visible(false)
        .build()?;
    Ok(())
}

/// Tray "Pause for 1 hour".
pub fn pause_for(app: &AppHandle, dur: Duration) {
    *app.state::<PetRuntime>()
        .paused_until
        .lock()
        .expect("runtime poisoned") = Some(Instant::now() + dur);
    reconcile(app);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(dur + Duration::from_secs(1));
        reconcile(&app);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_has_headroom_above_pet() {
        let (w, h) = window_size(150);
        assert_eq!((w, h), (225.0, 270.0));
    }
}
