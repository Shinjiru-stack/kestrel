use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::models::{AuditEntry, now_iso};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    Ollama,
    Gemini,
    OpenRouter,
    Anthropic,
    GithubCopilot,
}

impl ProviderKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ollama => "ollama",
            Self::Gemini => "gemini",
            Self::OpenRouter => "openrouter",
            Self::Anthropic => "anthropic",
            Self::GithubCopilot => "githubCopilot",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Ollama => "Ollama",
            Self::Gemini => "Gemini",
            Self::OpenRouter => "OpenRouter",
            Self::Anthropic => "Anthropic",
            Self::GithubCopilot => "GitHub Copilot",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "ollama" => Some(Self::Ollama),
            "gemini" => Some(Self::Gemini),
            "openrouter" => Some(Self::OpenRouter),
            "anthropic" => Some(Self::Anthropic),
            "githubCopilot" | "github-copilot" | "copilot" => Some(Self::GithubCopilot),
            _ => None,
        }
    }

    pub fn all() -> Vec<Self> {
        vec![
            Self::Ollama,
            Self::Gemini,
            Self::OpenRouter,
            Self::Anthropic,
            Self::GithubCopilot,
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    pub kind: String,
    pub label: String,
    pub enabled: bool,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub latency_ms: u64,
    #[serde(default)]
    pub hint: String,
    #[serde(default)]
    pub docs_url: String,
    #[serde(default)]
    pub mode: String,
}

impl ProviderSettings {
    fn new(
        kind: ProviderKind,
        base_url: &str,
        model: &str,
        hint: &str,
        docs_url: &str,
        enabled: bool,
    ) -> Self {
        Self {
            kind: kind.as_str().to_string(),
            label: kind.label().to_string(),
            enabled,
            base_url: base_url.to_string(),
            api_key: String::new(),
            model: model.to_string(),
            models: Vec::new(),
            status: "unconfigured".to_string(),
            latency_ms: 0,
            hint: hint.to_string(),
            docs_url: docs_url.to_string(),
            mode: if kind == ProviderKind::GithubCopilot {
                "auto".to_string()
            } else {
                String::new()
            },
        }
    }

    pub fn has_key(&self) -> bool {
        !self.api_key.trim().is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafetySettings {
    pub protected_namespaces: Vec<String>,
    pub require_confirmation: bool,
    pub max_oom_patch_count: i32,
    pub max_memory_mi: i64,
    pub allow_destructive: bool,
    pub redact_logs: bool,
}

impl Default for SafetySettings {
    fn default() -> Self {
        Self {
            protected_namespaces: vec![
                "kube-system".into(),
                "kube-public".into(),
                "kube-node-lease".into(),
            ],
            require_confirmation: true,
            max_oom_patch_count: 3,
            max_memory_mi: 1024,
            allow_destructive: false,
            redact_logs: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: String,
    pub density: String,
    pub reduce_motion: bool,
    pub show_seconds: bool,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            density: "comfortable".into(),
            reduce_motion: false,
            show_seconds: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub kubeconfig_path: String,
    pub context: String,
    pub active_provider: String,
    pub active_model: String,
    pub providers: Vec<ProviderSettings>,
    pub safety: SafetySettings,
    pub appearance: AppearanceSettings,
    pub onboarding_complete: bool,
    pub telemetry: bool,
}

impl Default for Settings {
    fn default() -> Self {
        let providers = vec![
            ProviderSettings::new(
                ProviderKind::Ollama,
                "http://127.0.0.1:11434",
                "qwen2.5:7b",
                "Runs entirely on this machine. No key required.",
                "https://ollama.com",
                true,
            ),
            ProviderSettings::new(
                ProviderKind::Gemini,
                "https://generativelanguage.googleapis.com/v1beta",
                "gemini-2.5-flash",
                "Get a key from Google AI Studio.",
                "https://aistudio.google.com/apikey",
                false,
            ),
            ProviderSettings::new(
                ProviderKind::OpenRouter,
                "https://openrouter.ai/api/v1",
                "openrouter/auto",
                "One key for hundreds of models.",
                "https://openrouter.ai/keys",
                false,
            ),
            ProviderSettings::new(
                ProviderKind::Anthropic,
                "https://api.anthropic.com/v1",
                "claude-sonnet-4-5",
                "Direct Anthropic Messages API.",
                "https://console.anthropic.com/settings/keys",
                false,
            ),
            ProviderSettings::new(
                ProviderKind::GithubCopilot,
                "https://api.githubcopilot.com",
                "gpt-4o",
                "Uses a GitHub token. Falls back to GitHub Models if Copilot is unavailable.",
                "https://github.com/settings/tokens",
                false,
            ),
        ];
        Self {
            kubeconfig_path: default_kubeconfig(),
            context: String::new(),
            active_provider: "ollama".into(),
            active_model: "qwen2.5:7b".into(),
            providers,
            safety: SafetySettings::default(),
            appearance: AppearanceSettings::default(),
            onboarding_complete: false,
            telemetry: false,
        }
    }
}

pub fn default_kubeconfig() -> String {
    if let Ok(path) = std::env::var("KUBECONFIG")
        && !path.trim().is_empty()
    {
        return path.split(';').next().unwrap_or(path.as_str()).to_string();
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    if !home.is_empty() {
        // Prefer an explicit k3s kubeconfig when the operator has one,
        // otherwise fall back to the standard kubeconfig.
        let k3s = PathBuf::from(&home).join(".kube").join("k3s-healer.yaml");
        if k3s.exists() {
            return k3s.to_string_lossy().to_string();
        }
        let p = PathBuf::from(&home).join(".kube").join("config");
        if p.exists() {
            return p.to_string_lossy().to_string();
        }
    }
    String::new()
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        let mut settings = std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Settings>(s.trim_start_matches('\u{feff}')).ok())
            .unwrap_or_default();
        if settings.kubeconfig_path.trim().is_empty() {
            settings.kubeconfig_path = default_kubeconfig();
        }
        // Keep provider metadata stable across upgrades.
        for kind in ProviderKind::all() {
            if !settings.providers.iter().any(|p| p.kind == kind.as_str()) {
                let default = Settings::default()
                    .providers
                    .into_iter()
                    .find(|p| p.kind == kind.as_str())
                    .unwrap();
                settings.providers.push(default);
            }
        }
        settings
    }

    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let body = serde_json::to_string_pretty(self)?;
        std::fs::write(path, body)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    pub fn provider(&self, kind: &str) -> Option<&ProviderSettings> {
        self.providers.iter().find(|p| p.kind == kind)
    }

    pub fn provider_mut(&mut self, kind: &str) -> Option<&mut ProviderSettings> {
        self.providers.iter_mut().find(|p| p.kind == kind)
    }

    pub fn active(&self) -> Option<&ProviderSettings> {
        self.provider(&self.active_provider)
    }

    pub fn is_protected(&self, namespace: &str) -> bool {
        self.safety
            .protected_namespaces
            .iter()
            .any(|n| n == namespace)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuditLog {
    #[serde(default)]
    pub entries: Vec<AuditEntry>,
}

impl AuditLog {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
            .unwrap_or_default()
    }

    pub fn push(
        &mut self,
        action: impl Into<String>,
        target: impl Into<String>,
        status: impl Into<String>,
        detail: impl Into<String>,
    ) -> AuditEntry {
        let entry = AuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: now_iso(),
            action: action.into(),
            target: target.into(),
            status: status.into(),
            detail: detail.into(),
        };
        self.entries.insert(0, entry.clone());
        self.entries.truncate(250);
        entry
    }

    pub fn save(&self, path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(body) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(path, body);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_kinds_round_trip() {
        for kind in ProviderKind::all() {
            assert_eq!(ProviderKind::parse(kind.as_str()), Some(kind));
        }
        assert_eq!(
            ProviderKind::parse("github-copilot"),
            Some(ProviderKind::GithubCopilot)
        );
        assert_eq!(ProviderKind::parse("unknown"), None);
    }

    #[test]
    fn safe_defaults_are_opt_in() {
        let settings = Settings::default();
        assert!(!settings.safety.allow_destructive);
        assert!(settings.safety.require_confirmation);
        assert!(settings.safety.redact_logs);
        assert_eq!(settings.safety.max_memory_mi, 1024);
        assert!(settings.is_protected("kube-system"));
        assert!(!settings.is_protected("default"));
    }
}
