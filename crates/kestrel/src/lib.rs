mod commands;
mod state;

use std::path::PathBuf;

use state::AppState;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

pub fn run() {
    // rustls is pulled in by both kube and reqwest. Install one process-wide
    // CryptoProvider before any TLS client is constructed.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("kestrel=info,kestrel_core=info,tao=warn,wry=warn"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();

    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&data_dir)?;

            // Carry local settings and the audit trail across the rename from
            // the pre-Kestrel bundle identifier. Copy only when the new path
            // has no data yet, so an existing install is never overwritten.
            if let Ok(roaming) = app.path().data_dir() {
                let legacy_dir = roaming.join("com.k8shealer.desktop");
                if legacy_dir != data_dir {
                    for file in ["settings.json", "audit.json"] {
                        let source = legacy_dir.join(file);
                        let target = data_dir.join(file);
                        if source.is_file() && !target.exists() {
                            let _ = std::fs::copy(&source, &target);
                        }
                    }
                }
            }

            let settings_path = data_dir.join("settings.json");
            let audit_path = data_dir.join("audit.json");
            app.manage(AppState::new(settings_path, audit_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap,
            commands::connect_cluster,
            commands::refresh_snapshot,
            commands::get_pod_detail,
            commands::get_logs,
            commands::get_security_reports,
            commands::diagnose_pod,
            commands::chat,
            commands::run_action,
            commands::save_settings,
            commands::test_provider,
            commands::list_models,
            commands::get_audit,
            commands::open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kestrel");
}
