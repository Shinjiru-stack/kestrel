use std::process::Command;
use std::sync::OnceLock;

use kestrel_core::ai::{self, AiMessage, AiResponse, ChatRequest};
use kestrel_core::kube_client::{self, ClusterClient};
use kestrel_core::models::{
    ActionSpec, AuditEntry, ClusterSnapshot, Diagnosis, LogResponse, PodDetail, SecurityReport,
};
use kestrel_core::settings::{ProviderKind, Settings, default_kubeconfig};
use kestrel_core::updates::{self, UpdateInfo};
use regex::Regex;
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    settings: Settings,
    audit: Vec<AuditEntry>,
    app_version: String,
    platform: String,
    is_tauri: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTest {
    models: Vec<String>,
    latency_ms: u64,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    message: String,
    audit: Vec<AuditEntry>,
}

#[tauri::command]
pub async fn get_bootstrap(state: State<'_, AppState>) -> Result<Bootstrap, String> {
    let inner = state.inner.read().await;
    Ok(Bootstrap {
        settings: inner.settings.clone(),
        audit: inner.audit.entries.clone(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        is_tauri: true,
    })
}

#[tauri::command]
pub async fn check_for_updates() -> Result<Option<UpdateInfo>, String> {
    updates::check(env!("CARGO_PKG_VERSION"))
        .await
        .map_err(|err| format!("{err:#}"))
}

#[tauri::command]
pub async fn connect_cluster(
    state: State<'_, AppState>,
    kubeconfig_path: Option<String>,
    context: Option<String>,
) -> Result<ClusterSnapshot, String> {
    let (fallback_path, fallback_context) = {
        let inner = state.inner.read().await;
        (
            inner.settings.kubeconfig_path.clone(),
            inner.settings.context.clone(),
        )
    };
    let path = pick(kubeconfig_path, fallback_path);
    let context = pick(context, fallback_context);
    let path = if path.trim().is_empty() {
        default_kubeconfig()
    } else {
        path
    };

    let client = match ClusterClient::connect(&path, &context).await {
        Ok(client) => client,
        Err(err) => {
            clear_connection(&state).await;
            return Err(format!("{err:#}"));
        }
    };

    let snapshot = match client.snapshot().await {
        Ok(snapshot) => snapshot,
        Err(err) => {
            clear_connection(&state).await;
            return Err(format!(
                "Connected to the API server, but the snapshot failed: {err:#}"
            ));
        }
    };

    {
        let mut inner = state.inner.write().await;
        inner.settings.kubeconfig_path = path;
        inner.settings.context = context;
        inner.client = Some(client);
        inner.snapshot = Some(snapshot.clone());
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn refresh_snapshot(state: State<'_, AppState>) -> Result<ClusterSnapshot, String> {
    let client = client(&state).await?;
    let snapshot = match client.snapshot().await {
        Ok(snapshot) => snapshot,
        Err(err) => {
            clear_connection(&state).await;
            return Err(format!("Cluster link lost: {err:#}"));
        }
    };
    state.inner.write().await.snapshot = Some(snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
pub async fn get_pod_detail(
    state: State<'_, AppState>,
    namespace: String,
    name: String,
) -> Result<PodDetail, String> {
    let client = client(&state).await?;
    client
        .pod_detail(&namespace, &name)
        .await
        .map_err(|err| format!("{err:#}"))
}

#[tauri::command]
pub async fn get_logs(
    state: State<'_, AppState>,
    namespace: String,
    name: String,
    container: Option<String>,
    tail: Option<i64>,
    previous: Option<bool>,
) -> Result<LogResponse, String> {
    let client = client(&state).await?;
    let container = container
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Ok(client
        .logs(
            &namespace,
            &name,
            container,
            tail.unwrap_or(200),
            previous.unwrap_or(false),
        )
        .await)
}

#[tauri::command]
pub async fn get_security_reports(
    state: State<'_, AppState>,
) -> Result<Vec<SecurityReport>, String> {
    let client = client(&state).await?;
    client
        .security_reports()
        .await
        .map_err(|err| format!("{err:#}"))
}

#[tauri::command]
pub async fn diagnose_pod(
    state: State<'_, AppState>,
    namespace: String,
    name: String,
    container: Option<String>,
) -> Result<Diagnosis, String> {
    let (settings, client, snapshot) = {
        let inner = state.inner.read().await;
        (
            inner.settings.clone(),
            inner
                .client
                .clone()
                .ok_or_else(|| "No cluster is connected. Reconnect first.".to_string())?,
            inner.snapshot.clone(),
        )
    };
    if settings.active().is_none() {
        return Err("No active AI provider is configured. Choose one in Settings.".into());
    }

    let detail = client
        .pod_detail(&namespace, &name)
        .await
        .map_err(|err| format!("{err:#}"))?;
    let container_name = container
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| detail.containers.first().map(|c| c.name.clone()))
        .unwrap_or_default();

    let mut logs = client
        .logs(
            &namespace,
            &name,
            if container_name.is_empty() {
                None
            } else {
                Some(container_name.clone())
            },
            240,
            false,
        )
        .await;
    if logs.lines.is_empty() {
        let previous = client
            .logs(
                &namespace,
                &name,
                if container_name.is_empty() {
                    None
                } else {
                    Some(container_name)
                },
                240,
                true,
            )
            .await;
        if !previous.lines.is_empty() {
            logs = previous;
        }
    }
    if settings.safety.redact_logs {
        for line in &mut logs.lines {
            line.text = redact_secrets(&line.text);
        }
    }

    let snapshot = match snapshot {
        Some(snapshot) => Some(snapshot),
        None => client.snapshot().await.ok(),
    };
    ai::diagnose(&settings, &detail, Some(&logs), snapshot.as_ref())
        .await
        .map_err(|err| format!("{err:#}"))
}

#[tauri::command]
pub async fn chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    messages: Vec<AiMessage>,
    context: Option<Value>,
) -> Result<AiResponse, String> {
    let settings = state.inner.read().await.settings.clone();
    let provider = settings.active().cloned().ok_or_else(|| {
        "No active AI provider is configured. Choose one in Settings.".to_string()
    })?;

    let mut messages = messages;
    if settings.safety.redact_logs {
        for message in &mut messages {
            message.content = redact_secrets(&message.content);
        }
    }
    let system = chat_system_prompt(
        context.as_ref().unwrap_or(&Value::Null),
        settings.safety.redact_logs,
    );
    let request = ChatRequest {
        system,
        messages,
        temperature: 0.25,
        max_tokens: 4096,
        json: false,
    };

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let event_app = app.clone();
    let event_request = request_id.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(delta) = rx.recv().await {
            let _ = event_app.emit(
                "ai://delta",
                json!({ "requestId": event_request, "delta": delta }),
            );
        }
    });

    ai::stream(&provider, &request, tx)
        .await
        .map_err(|err| format!("{err:#}"))
}

#[tauri::command]
pub async fn run_action(
    state: State<'_, AppState>,
    action: ActionSpec,
) -> Result<ActionResult, String> {
    let (settings, client) = {
        let inner = state.inner.read().await;
        (
            inner.settings.clone(),
            inner
                .client
                .clone()
                .ok_or_else(|| "No cluster is connected. Reconnect first.".to_string())?,
        )
    };

    let namespace = action_namespace(&action).to_string();
    if settings.is_protected(&namespace) || kube_client::is_protected_namespace(&namespace) {
        return Err(format!(
            "{namespace} is a protected namespace. Kestrel will not mutate it."
        ));
    }
    match &action {
        ActionSpec::DeletePod { .. } if !settings.safety.allow_destructive => {
            return Err("Destructive actions are disabled in Safety settings.".into());
        }
        ActionSpec::ScaleWorkload { replicas, .. } if *replicas < 0 => {
            return Err("Replica count cannot be negative.".into());
        }
        ActionSpec::PatchResources { resources, .. } => {
            if settings.safety.max_memory_mi > 0
                && let Some(mi) = requested_memory_mi(resources)
                && mi > settings.safety.max_memory_mi as f64
            {
                return Err(format!(
                    "Memory request of {mi:.0}Mi exceeds the safety ceiling of {}Mi.",
                    settings.safety.max_memory_mi
                ));
            }
        }
        _ => {}
    }

    let target = action_target(&action);
    let kind = action.kind();
    match client.apply_action(&action).await {
        Ok(message) => {
            let audit = {
                let mut inner = state.inner.write().await;
                inner.audit.push(kind, target, "success", message.clone());
                inner.audit.save(&state.audit_path);
                inner.audit.entries.clone()
            };
            Ok(ActionResult { message, audit })
        }
        Err(err) => {
            let detail = format!("{err:#}");
            let mut inner = state.inner.write().await;
            inner.audit.push(kind, target, "error", detail.clone());
            inner.audit.save(&state.audit_path);
            Err(detail)
        }
    }
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    let mut settings = settings;
    if settings.kubeconfig_path.trim().is_empty() {
        settings.kubeconfig_path = default_kubeconfig();
    }
    for kind in ProviderKind::all() {
        if !settings.providers.iter().any(|p| p.kind == kind.as_str())
            && let Some(default) = Settings::default()
                .providers
                .into_iter()
                .find(|p| p.kind == kind.as_str())
        {
            settings.providers.push(default);
        }
    }
    if settings.provider(&settings.active_provider).is_none() {
        settings.active_provider = "ollama".into();
    }
    if settings.active_model.trim().is_empty()
        && let Some(model) = settings
            .provider(&settings.active_provider)
            .map(|active| active.model.clone())
    {
        settings.active_model = model;
    }
    settings
        .save(&state.settings_path)
        .map_err(|err| format!("{err:#}"))?;
    state.inner.write().await.settings = settings.clone();
    Ok(settings)
}

#[tauri::command]
pub async fn test_provider(
    state: State<'_, AppState>,
    kind: String,
) -> Result<ProviderTest, String> {
    let provider = {
        let inner = state.inner.read().await;
        inner
            .settings
            .provider(&kind)
            .cloned()
            .ok_or_else(|| format!("Unknown provider: {kind}"))?
    };
    let (models, latency_ms) = ai::test_provider(&provider)
        .await
        .map_err(|err| format!("{err:#}"))?;
    let status = if models.is_empty() { "error" } else { "ready" };
    Ok(ProviderTest {
        models,
        latency_ms,
        status: status.into(),
    })
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>, kind: String) -> Result<Vec<String>, String> {
    let provider = {
        let inner = state.inner.read().await;
        inner
            .settings
            .provider(&kind)
            .cloned()
            .ok_or_else(|| format!("Unknown provider: {kind}"))?
    };
    ai::list_models(&provider)
        .await
        .map_err(|err| format!("{err:#}"))
}

#[tauri::command]
pub async fn get_audit(state: State<'_, AppState>) -> Result<Vec<AuditEntry>, String> {
    Ok(state.audit_entries().await)
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http and https URLs can be opened.".into());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", parsed.as_str()])
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

async fn client(state: &State<'_, AppState>) -> Result<ClusterClient, String> {
    state
        .inner
        .read()
        .await
        .client
        .clone()
        .ok_or_else(|| "No cluster is connected. Reconnect first.".to_string())
}

async fn clear_connection(state: &State<'_, AppState>) {
    let mut inner = state.inner.write().await;
    inner.client = None;
    inner.snapshot = None;
}

fn pick(value: Option<String>, fallback: String) -> String {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
}

fn action_namespace(action: &ActionSpec) -> &str {
    match action {
        ActionSpec::RestartWorkload { namespace, .. }
        | ActionSpec::DeletePod { namespace, .. }
        | ActionSpec::PatchImage { namespace, .. }
        | ActionSpec::PatchResources { namespace, .. }
        | ActionSpec::ScaleWorkload { namespace, .. }
        | ActionSpec::RollbackDeployment { namespace, .. } => namespace,
    }
}

fn action_target(action: &ActionSpec) -> String {
    match action {
        ActionSpec::RestartWorkload {
            namespace, name, ..
        }
        | ActionSpec::DeletePod { namespace, name }
        | ActionSpec::PatchImage {
            namespace, name, ..
        }
        | ActionSpec::PatchResources {
            namespace, name, ..
        }
        | ActionSpec::ScaleWorkload {
            namespace, name, ..
        }
        | ActionSpec::RollbackDeployment {
            namespace, name, ..
        } => {
            format!("{namespace}/{name}")
        }
    }
}

fn requested_memory_mi(resources: &Value) -> Option<f64> {
    let mut highest: Option<f64> = None;
    for section in ["limits", "requests"] {
        if let Some(value) = resources
            .get(section)
            .and_then(|value| value.get("memory"))
            .and_then(Value::as_str)
        {
            let mi = kestrel_core::models::parse_memory_bytes(value) / (1024.0 * 1024.0);
            highest = Some(highest.map_or(mi, |current: f64| current.max(mi)));
        }
    }
    highest
}

fn chat_system_prompt(context: &Value, redact: bool) -> String {
    let mut context = serde_json::to_string_pretty(context).unwrap_or_else(|_| "{}".into());
    if redact {
        context = redact_secrets(&context);
    }
    if context.chars().count() > 60_000 {
        context = context.chars().take(60_000).collect::<String>() + "\n… truncated …";
    }
    format!(
        r#"You are Kestrel Copilot, a principal Kubernetes site-reliability engineer embedded in a desktop incident console.

You receive a live JSON context containing cluster, pod, node, workload, event, security, and log evidence. Treat it as the only source of truth. Never invent resources, log lines, events, metrics, or command output. If the evidence is insufficient, say exactly what is missing and which read-only command would gather it.

Operating rules:
- You cannot mutate the cluster. Never claim that you applied, restarted, patched, scaled, or deleted anything. You may propose a remediation, but the operator must approve it in the app.
- Ground every diagnosis in specific names and observations from the context.
- Prefer read-only kubectl commands that a human can verify. Do not suggest destructive commands unless the evidence is unambiguous, and call out the risk.
- Protect kube-system, kube-public, and kube-node-lease. Never recommend mutations there.
- Never echo credentials, bearer tokens, API keys, passwords, or secret values.
- Be concise and operational. Lead with the conclusion, then evidence, then the shortest safe next step. Use short Markdown sections and bullets; avoid filler.
- If the operator asks for a broad review, rank findings by blast radius and urgency.

Live cluster context:
```json
{context}
```"#
    )
}

fn redact_secrets(input: &str) -> String {
    static JSON_SECRET: OnceLock<Regex> = OnceLock::new();
    static BEARER: OnceLock<Regex> = OnceLock::new();
    let json_secret = JSON_SECRET.get_or_init(|| {
        Regex::new(r#"(?i)("(?:api[_-]?key|password|passwd|token|secret|authorization|client[_-]?secret)"\s*:\s*")[^"]*(")"#)
            .expect("valid redaction regex")
    });
    let bearer = BEARER.get_or_init(|| {
        Regex::new(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+").expect("valid bearer regex")
    });
    let output = json_secret.replace_all(input, "$1[redacted]$2");
    bearer.replace_all(&output, "$1[redacted]").into_owned()
}
