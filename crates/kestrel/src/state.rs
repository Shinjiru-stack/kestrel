use std::path::PathBuf;

use kestrel_core::kube_client::ClusterClient;
use kestrel_core::models::{AuditEntry, ClusterSnapshot};
use kestrel_core::settings::{AuditLog, Settings};
use tokio::sync::RwLock;

pub struct Inner {
    pub settings: Settings,
    pub audit: AuditLog,
    pub client: Option<ClusterClient>,
    pub snapshot: Option<ClusterSnapshot>,
}

pub struct AppState {
    pub inner: RwLock<Inner>,
    pub settings_path: PathBuf,
    pub audit_path: PathBuf,
}

impl AppState {
    pub fn new(settings_path: PathBuf, audit_path: PathBuf) -> Self {
        let mut settings = Settings::load(&settings_path);
        if settings.kubeconfig_path.trim().is_empty() {
            settings.kubeconfig_path = kestrel_core::settings::default_kubeconfig();
        }
        let audit = AuditLog::load(&audit_path);
        Self {
            inner: RwLock::new(Inner {
                settings,
                audit,
                client: None,
                snapshot: None,
            }),
            settings_path,
            audit_path,
        }
    }

    pub async fn audit_entries(&self) -> Vec<AuditEntry> {
        self.inner.read().await.audit.entries.clone()
    }
}
