use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const SETTINGS: &str = "settings";

/// Shows the settings window, creating it on demand. It is destroyed on close
/// (not hidden) so it costs no memory while the pet runs all day.
pub fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(SETTINGS) {
        win.unminimize()?;
        win.show()?;
        return win.set_focus();
    }
    let win = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App("settings.html".into()))
        .title("DeskPals")
        .inner_size(560.0, 640.0)
        .min_inner_size(420.0, 480.0)
        .center()
        .build()?;
    win.set_focus()
}
