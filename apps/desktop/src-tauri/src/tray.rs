use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter,
};

use crate::windows;

/// Tray menu item ids. Items not yet implemented emit `tray://<id>` to the frontend.
const ITEMS: &[(&str, &str)] = &[
    ("toggle_pets", "Show / Hide Pets"),
    ("focus", "Start Focus Timer"),
    ("tidy", "Tidy Desktop…"),
    ("friends", "Friends…"),
    ("settings", "Settings…"),
    ("pause", "Pause for 1 Hour"),
];

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let mut menu_items = Vec::new();
    for (id, label) in ITEMS {
        menu_items.push(MenuItem::with_id(app, *id, *label, true, None::<&str>)?);
    }
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit DeskPals", true, None::<&str>)?;

    let mut refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        menu_items.iter().map(|i| i as _).collect();
    refs.push(&sep);
    refs.push(&quit);
    let menu = Menu::with_items(app, &refs)?;

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        // Template icons adapt to the light/dark macOS menu bar.
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("DeskPals")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => {
                if let Err(e) = windows::show_settings(app) {
                    log::error!("failed to open settings: {e}");
                }
            }
            other => {
                let _ = app.emit(&format!("tray://{other}"), ());
            }
        })
        .build(app)?;
    Ok(())
}
