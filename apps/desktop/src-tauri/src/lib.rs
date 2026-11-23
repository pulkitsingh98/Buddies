mod hit_test;
mod models;
mod pet_windows;
mod pets;
mod settings;
mod system;
mod tray;
mod windows;

use tauri::{Manager, RunEvent};

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
        .manage(hit_test::HitMasks::default())
        .manage(pet_windows::PetRuntime::default())
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::update_settings,
            pets::list_pets,
            pets::get_pet,
            pets::get_pet_sprite,
            pets::save_pet_sprite,
            pets::save_pet_manifest,
            pets::delete_pet,
            hit_test::set_hit_mask,
            system::get_user_idle_seconds,
            models::ensure_segmentation_assets,
            models::read_segmentation_asset,
            windows::open_creator,
            windows::open_settings,
        ])
        .setup(|app| {
            // Menu-bar-only app: no Dock icon on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_dir = app.path().app_config_dir()?;
            app.manage(settings::SettingsState::load(
                config_dir.join("settings.json"),
            ));

            tray::create(app.handle())?;
            hit_test::start(app.handle().clone());
            system::start_fullscreen_watch(app.handle().clone());
            pet_windows::reconcile(app.handle());

            // First run: no pets yet, so go straight to making one.
            if pets::list_pets(app.handle().clone()).is_ok_and(|p| p.is_empty()) {
                windows::show_creator(app.handle())?;
            }
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
