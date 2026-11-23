use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const SETTINGS: &str = "settings";
pub const CREATOR: &str = "creator";
pub const FRIENDS: &str = "friends";
pub const SOCIAL: &str = "social";
pub const CHORES: &str = "chores";
pub const ONBOARDING: &str = "onboarding";

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

pub fn show_friends(app: &AppHandle) -> tauri::Result<()> {
    show(app, FRIENDS, "friends.html", "Friends", (480.0, 680.0))
}

/// Hidden window that holds the realtime connection (presence, incoming visits and messages)
/// for as long as the app runs.
pub fn start_social(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(SOCIAL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, SOCIAL, WebviewUrl::App("social.html".into()))
        .title("DeskPals social")
        .visible(false)
        .focused(false)
        .focusable(false)
        .skip_taskbar(true)
        .inner_size(200.0, 200.0)
        .build()?;
    Ok(())
}

pub fn show_chores(app: &AppHandle) -> tauri::Result<()> {
    show(app, CHORES, "chores.html", "Chores", (520.0, 680.0))
}

pub fn show_onboarding(app: &AppHandle) -> tauri::Result<()> {
    show(
        app,
        ONBOARDING,
        "onboarding.html",
        "Welcome to DeskPals",
        (560.0, 640.0),
    )
}

#[tauri::command]
pub fn open_chores(app: AppHandle) -> Result<(), String> {
    show_chores(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_friends(app: AppHandle) -> Result<(), String> {
    show_friends(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_creator(app: AppHandle) -> Result<(), String> {
    show_creator(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app).map_err(|e| e.to_string())
}
