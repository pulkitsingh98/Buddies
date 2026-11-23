use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const SETTINGS: &str = "settings";
pub const CREATOR: &str = "creator";

/// Shows (or creates) a regular app window. Windows are destroyed on close, not hidden,
/// so they cost no memory while pets run all day.
fn show(
    app: &AppHandle,
    label: &str,
    page: &str,
    title: &str,
    size: (f64, f64),
) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(label) {
        win.unminimize()?;
        win.show()?;
        return win.set_focus();
    }
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(page.into()))
        .title(title)
        .inner_size(size.0, size.1)
        .min_inner_size(420.0, 480.0)
        .center();
    // The creator handles photo drops itself (HTML drag & drop), so disable the native handler.
    let builder = if label == CREATOR {
        builder.disable_drag_drop_handler()
    } else {
        builder
    };
    builder.build()?.set_focus()
}

pub fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    show(app, SETTINGS, "settings.html", "DeskPals", (560.0, 680.0))
}

pub fn show_creator(app: &AppHandle) -> tauri::Result<()> {
    show(app, CREATOR, "creator.html", "Make a pet", (640.0, 760.0))
}

#[tauri::command]
pub fn open_creator(app: AppHandle) -> Result<(), String> {
    show_creator(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app).map_err(|e| e.to_string())
}
