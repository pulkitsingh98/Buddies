mod tray;
mod windows;

use tauri::RunEvent;

pub fn run() {
    let app = tauri::Builder::default()
        // Must be registered first so a second launch is caught before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = windows::show_settings(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Menu-bar-only app: no Dock icon on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            tray::create(app.handle())?;
            log::info!("DeskPals started v{}", app.package_info().version);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building DeskPals");

    app.run(|_app, event| {
        // Closing the last window must not quit: the app lives in the tray.
        // Only an explicit exit (tray Quit → app.exit(0)) carries a code.
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
