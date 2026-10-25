use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClusterInfo {
    pub name: String,
    pub version: String,
    pub provider: String,
    pub server: String,
    pub context: String,
    pub latency_ms: u64,
    pub connection: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClusterSnapshot {
    pub cluster: ClusterInfo,
    pub nodes: Vec<NodeSummary>,
    pub pods: Vec<PodSummary>,
    pub workloads: Vec<WorkloadSummary>,
    pub namespaces: Vec<NamespaceSummary>,
    pub events: Vec<ClusterEvent>,
    pub metrics_available: bool,
    #[serde(default)]
    pub warnings: Vec<String>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    pub r#type: String,
    pub status: String,
    pub reason: String,
    pub message: String,
    pub last_transition_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeSummary {
    pub name: String,
    pub status: String,
    pub roles: Vec<String>,
    pub version: String,
    pub os: String,
    pub arch: String,
    pub internal_ip: String,
    pub age_seconds: i64,
    pub pods: i64,
    pub pod_capacity: i64,
    pub cpu_capacity: String,
    pub memory_capacity: String,
    pub cpu_cores: f64,
    pub memory_bytes: f64,
    pub cpu_usage: Option<f64>,
    pub memory_usage: Option<f64>,
    pub conditions: Vec<Condition>,
    pub taints: Vec<String>,
    pub labels: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OwnerRef {
    pub kind: String,
    pub name: String,
    pub namespace: String,
    #[serde(default)]
    pub standalone: bool,
    #[serde(default)]
    pub immediate_kind: String,
    #[serde(default)]
    pub immediate_name: String,
    #[serde(default)]
    pub protected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContainerBrief {
    pub name: String,
    pub image: String,
    pub ready: bool,
    pub restarts: i32,
    pub state: String,
    pub reason: String,
    pub last_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PodSummary {
    pub uid: String,
    pub namespace: String,
    pub name: String,
    pub phase: String,
    pub status: String,
    pub reason: String,
    pub ready: String,
    pub restarts: i32,
    pub node: String,
    pub age_seconds: i64,
    pub created_at: String,
    pub owner: Option<OwnerRef>,
    pub labels: std::collections::BTreeMap<String, String>,
    pub containers: Vec<ContainerBrief>,
    pub images: Vec<String>,
    pub cpu_usage: Option<f64>,
    pub memory_usage: Option<f64>,
    pub health: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkloadSummary {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub desired: i32,
    pub ready: i32,
    pub updated: i32,
    pub available: i32,
    pub age_seconds: i64,
    pub images: Vec<String>,
    pub status: String,
    pub labels: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NamespaceSummary {
    pub name: String,
    pub pods: i64,
    pub healthy: i64,
    pub warning: i64,
    pub failed: i64,
    pub cpu_usage: Option<f64>,
    pub memory_usage: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClusterEvent {
    pub id: String,
    pub r#type: String,
    pub reason: String,
    pub message: String,
    pub namespace: String,
    pub involved_kind: String,
    pub involved_name: String,
    pub count: i32,
    pub last_seen: String,
    pub source: String,
    pub age_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub name: String,
    pub value: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub name: String,
    pub container_port: i32,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDetail {
    pub name: String,
    pub image: String,
    pub ready: bool,
    pub restarts: i32,
    pub state: String,
    pub reason: String,
    pub last_reason: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub exit_code: Option<i32>,
    pub resources: serde_json::Value,
    pub ports: Vec<PortInfo>,
    pub env: Vec<EnvVar>,
    pub command: Vec<String>,
    pub args: Vec<String>,
    pub volume_mounts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PodDetail {
    pub pod: PodSummary,
    pub owner: OwnerRef,
    pub conditions: Vec<Condition>,
    pub containers: Vec<ContainerDetail>,
    pub service_account: String,
    pub restart_policy: String,
    pub qos_class: String,
    pub priority_class: String,
    pub pod_ip: String,
    pub host_ip: String,
    pub node_name: String,
    pub suggestions: Vec<Suggestion>,
    pub events: Vec<ClusterEvent>,
    pub labels: std::collections::BTreeMap<String, String>,
    pub annotations: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub id: String,
    pub kind: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub action: Option<ActionSpec>,
    pub risk: String,
    pub safe: bool,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ActionSpec {
    RestartWorkload {
        kind: String,
        namespace: String,
        name: String,
    },
    DeletePod {
        namespace: String,
        name: String,
    },
    PatchImage {
        kind: String,
        namespace: String,
        name: String,
        container: String,
        image: String,
    },
    PatchResources {
        kind: String,
        namespace: String,
        name: String,
        container: String,
        resources: serde_json::Value,
    },
    ScaleWorkload {
        kind: String,
        namespace: String,
        name: String,
        replicas: i32,
    },
    RollbackDeployment {
        namespace: String,
        name: String,
        revision: Option<i64>,
    },
}

impl ActionSpec {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::RestartWorkload { .. } => "restartWorkload",
            Self::DeletePod { .. } => "deletePod",
            Self::PatchImage { .. } => "patchImage",
            Self::PatchResources { .. } => "patchResources",
            Self::ScaleWorkload { .. } => "scaleWorkload",
            Self::RollbackDeployment { .. } => "rollbackDeployment",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub risk: String,
    pub action: Option<ActionSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Diagnosis {
    pub id: String,
    pub target: String,
    pub namespace: String,
    pub name: String,
    pub provider: String,
    pub model: String,
    pub summary: String,
    pub severity: String,
    pub root_cause: String,
    pub confidence: f64,
    pub evidence: Vec<String>,
    pub recommendations: Vec<Recommendation>,
    pub commands: Vec<String>,
    pub prevention: Vec<String>,
    pub created_at: String,
    pub usage: Usage,
    pub raw: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub timestamp: Option<String>,
    pub text: String,
    pub level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LogResponse {
    pub container: String,
    pub previous: bool,
    pub lines: Vec<LogLine>,
    pub truncated: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VulnerabilitySummary {
    pub critical: i64,
    pub high: i64,
    pub medium: i64,
    pub low: i64,
    pub unknown: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Vulnerability {
    pub id: String,
    pub package: String,
    pub version: String,
    pub severity: String,
    pub title: String,
    pub fixed_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SecurityReport {
    pub name: String,
    pub namespace: String,
    pub kind: String,
    pub workload: String,
    pub container: String,
    pub summary: VulnerabilitySummary,
    pub vulnerabilities: Vec<Vulnerability>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub timestamp: String,
    pub action: String,
    pub target: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClusterMetrics {
    pub pod_cpu: std::collections::HashMap<String, f64>,
    pub pod_memory: std::collections::HashMap<String, f64>,
    pub node_cpu: std::collections::HashMap<String, f64>,
    pub node_memory: std::collections::HashMap<String, f64>,
    pub available: bool,
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub fn age_seconds(created: Option<&k8s_openapi::jiff::Timestamp>) -> i64 {
    created
        .map(|c| (Utc::now().timestamp() - c.as_second()).max(0))
        .unwrap_or(0)
}

pub fn ts_string(ts: Option<&k8s_openapi::jiff::Timestamp>) -> String {
    ts.map(|t| t.to_string()).unwrap_or_default()
}

pub fn human_duration(seconds: i64) -> String {
    let s = seconds.max(0);
    if s < 60 {
        format!("{s}s")
    } else if s < 3600 {
        format!("{}m", s / 60)
    } else if s < 86400 {
        format!("{}h", s / 3600)
    } else {
        format!("{}d", s / 86400)
    }
}

pub fn parse_cpu_quantity(q: &str) -> f64 {
    let q = q.trim();
    if let Some(v) = q.strip_suffix('m') {
        v.parse::<f64>().unwrap_or(0.0) / 1000.0
    } else if let Some(v) = q.strip_suffix('n') {
        v.parse::<f64>().unwrap_or(0.0) / 1_000_000_000.0
    } else if let Some(v) = q.strip_suffix('u') {
        v.parse::<f64>().unwrap_or(0.0) / 1_000_000.0
    } else {
        q.parse::<f64>().unwrap_or(0.0)
    }
}

pub fn parse_memory_bytes(q: &str) -> f64 {
    let q = q.trim();
    let (num, mult) = if let Some(v) = q.strip_suffix("Ki") {
        (v, 1024.0)
    } else if let Some(v) = q.strip_suffix("Mi") {
        (v, 1024.0 * 1024.0)
    } else if let Some(v) = q.strip_suffix("Gi") {
        (v, 1024.0 * 1024.0 * 1024.0)
    } else if let Some(v) = q.strip_suffix("Ti") {
        (v, 1024.0 * 1024.0 * 1024.0 * 1024.0)
    } else if let Some(v) = q.strip_suffix('K') {
        (v, 1000.0)
    } else if let Some(v) = q.strip_suffix('M') {
        (v, 1_000_000.0)
    } else if let Some(v) = q.strip_suffix('G') {
        (v, 1_000_000_000.0)
    } else if let Some(v) = q.strip_suffix('T') {
        (v, 1_000_000_000_000.0)
    } else if let Some(v) = q.strip_suffix('k') {
        (v, 1000.0)
    } else {
        (q, 1.0)
    };
    num.parse::<f64>().unwrap_or(0.0) * mult
}

pub fn format_bytes(bytes: f64) -> String {
    if bytes >= 1024.0 * 1024.0 * 1024.0 {
        format!("{:.1} GiB", bytes / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024.0 * 1024.0 {
        format!("{:.0} MiB", bytes / (1024.0 * 1024.0))
    } else if bytes >= 1024.0 {
        format!("{:.0} KiB", bytes / 1024.0)
    } else {
        format!("{bytes:.0} B")
    }
}

pub fn status_from_pod(pod: &k8s_openapi::api::core::v1::Pod) -> (String, String, String, String) {
    let statuses = pod
        .status
        .as_ref()
        .and_then(|s| s.container_statuses.as_ref())
        .cloned()
        .unwrap_or_default();
    let mut phase = pod
        .status
        .as_ref()
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "Unknown".into());
    let mut reason = pod
        .status
        .as_ref()
        .and_then(|s| s.reason.clone())
        .unwrap_or_default();
    let mut health = match phase.as_str() {
        "Running" => "healthy",
        "Succeeded" => "healthy",
        "Pending" => "pending",
        "Failed" => "failed",
        _ => "warning",
    }
    .to_string();
    let mut severity = match health.as_str() {
        "healthy" => "info",
        "pending" => "warning",
        "failed" => "critical",
        _ => "warning",
    }
    .to_string();

    for cs in &statuses {
        if let Some(w) = &cs.state.as_ref().and_then(|s| s.waiting.as_ref()) {
            reason = w.reason.clone().unwrap_or_else(|| reason.clone());
            if matches!(
                reason.as_str(),
                "CrashLoopBackOff"
                    | "ImagePullBackOff"
                    | "ErrImagePull"
                    | "CreateContainerError"
                    | "RunContainerError"
                    | "CreateContainerConfigError"
                    | "InvalidImageName"
            ) {
                health = "failed".into();
                severity = "critical".into();
                phase = "Failed".into();
                break;
            }
            health = "warning".into();
            severity = "warning".into();
        }
        if let Some(t) = &cs.state.as_ref().and_then(|s| s.terminated.as_ref())
            && t.exit_code != 0
        {
            reason = t.reason.clone().unwrap_or_else(|| reason.clone());
            health = "failed".into();
            severity = "critical".into();
            phase = "Failed".into();
        }
        if let Some(l) = &cs.last_state.as_ref().and_then(|s| s.terminated.as_ref())
            && l.reason.as_deref() == Some("OOMKilled")
            && reason.is_empty()
        {
            reason = "OOMKilled".into();
            severity = "critical".into();
        }
    }

    if pod.metadata.deletion_timestamp.is_some() {
        phase = "Terminating".into();
        reason = "Terminating".into();
        health = "warning".into();
    }

    let ready_count = statuses.iter().filter(|s| s.ready).count();
    let total = if statuses.is_empty() {
        pod.spec.as_ref().map(|s| s.containers.len()).unwrap_or(0)
    } else {
        statuses.len()
    };
    let ready = format!("{ready_count}/{total}");

    if health == "healthy" && ready_count < total {
        health = "warning".into();
        severity = "warning".into();
        if reason.is_empty() {
            reason = "NotReady".into();
        }
    }

    (phase, reason, ready, format!("{health}|{severity}"))
}

pub fn severity_rank(s: &str) -> u8 {
    match s {
        "critical" => 0,
        "warning" => 1,
        "info" => 2,
        _ => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_kubernetes_memory_quantities() {
        assert_eq!(parse_memory_bytes("128Mi"), 134_217_728.0);
        assert_eq!(parse_memory_bytes("1Gi"), 1_073_741_824.0);
        assert_eq!(parse_memory_bytes("1.5Gi"), 1_610_612_736.0);
        assert_eq!(parse_memory_bytes("500M"), 500_000_000.0);
        assert_eq!(parse_memory_bytes("1024"), 1024.0);
    }

    #[test]
    fn invalid_memory_is_zero() {
        assert_eq!(parse_memory_bytes("not-a-quantity"), 0.0);
        assert_eq!(parse_memory_bytes(""), 0.0);
    }
}
