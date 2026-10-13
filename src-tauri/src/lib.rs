mod katago;
mod lan;
mod gnugo;
mod library;

use std::path::PathBuf;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let development_resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
            let bundled_resources = app.path().resource_dir()?.join("resources");
            let (runtime, configuration_error) =
                match katago::discover_runtime(&development_resources, &bundled_resources) {
                    Ok(runtime) => (Some(runtime), None),
                    Err(error) => (None, Some(error)),
                };
            let data_dir = app.path().app_local_data_dir()?.join("katago");
            std::fs::create_dir_all(&data_dir)?;
            let katago_state = katago::KataGoState::new(runtime, configuration_error, data_dir);
            let warmup_state = katago_state.clone();
            app.manage(katago_state);
            app.manage(lan::LanState::new());
            app.manage(gnugo::GnuGoState::default());
            tauri::async_runtime::spawn_blocking(move || {
                let _ = warmup_state.warmup();
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library::library_load,
            library::library_save,
            library::library_read_files,
            library::library_export_file,
            katago::engine_status,
            katago::analyze_position,
            katago::final_score,
            katago::cancel_analysis,
            katago::warmup_engine,
            gnugo::gnugo_adjudicate,
            gnugo::gnugo_estimate,
            gnugo::gnugo_cancel,
            lan::lan_get_local_addresses,
            lan::lan_scan_rooms,
            lan::lan_create_room,
            lan::lan_join_room,
            lan::lan_send_command,
            lan::lan_leave_room
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
