//! OS signals: user idle time, and "something full-screen is in front" (Windows).

/// Seconds since the last keyboard/mouse input, system-wide.
#[cfg(target_os = "macos")]
pub fn user_idle_seconds() -> f64 {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    }
    const COMBINED_SESSION_STATE: i32 = 0;
    const ANY_INPUT_EVENT: u32 = u32::MAX;
    // SAFETY: pure query with constant arguments.
    unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT) }
}

#[cfg(windows)]
pub fn user_idle_seconds() -> f64 {
    use windows_sys::Win32::{
        System::SystemInformation::GetTickCount,
        UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
    };
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: `info` is a valid, correctly sized out-parameter.
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return 0.0;
    }
    // SAFETY: no arguments.
    let now = unsafe { GetTickCount() };
    now.wrapping_sub(info.dwTime) as f64 / 1000.0
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn user_idle_seconds() -> f64 {
    0.0
}

/// True when a full-screen app, game or presentation is in front.
///
/// macOS needs no check: pet windows don't join full-screen Spaces, so they are simply not
/// shown there and WebKit stops rendering occluded windows.
#[cfg(windows)]
pub fn fullscreen_app_in_front() -> bool {
    use windows_sys::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
        QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    let mut state = 0;
    // SAFETY: valid out-parameter.
    if unsafe { SHQueryUserNotificationState(&mut state) } != 0 {
        return false;
    }
    matches!(
        state,
        QUNS_BUSY | QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE
    )
}

#[tauri::command]
pub fn get_user_idle_seconds() -> f64 {
    user_idle_seconds()
}

/// Hides pet windows (and tells them to stop rendering) while a full-screen app is in front.
#[cfg(windows)]
pub fn start_fullscreen_watch(app: tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    std::thread::Builder::new()
        .name("fullscreen-watch".into())
        .spawn(move || {
            let mut suspended = false;
            loop {
                let now = fullscreen_app_in_front();
                if now != suspended {
                    suspended = now;
                    for (label, win) in app.webview_windows() {
                        if label.starts_with(crate::pet_windows::LABEL_PREFIX) {
                            let _ = if now { win.hide() } else { win.show() };
                        }
                    }
                    let _ = app.emit("pets://suspend", now);
                }
                std::thread::sleep(std::time::Duration::from_secs(3));
            }
        })
        .expect("spawn fullscreen-watch thread");
}

#[cfg(not(windows))]
pub fn start_fullscreen_watch(_app: tauri::AppHandle) {}

#[cfg(test)]
mod tests {
    #[test]
    fn idle_time_is_non_negative() {
        assert!(super::user_idle_seconds() >= 0.0);
    }
}
