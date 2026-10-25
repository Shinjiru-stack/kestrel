use k8s_openapi::api::core::v1::{Container, Pod};
use serde_json::{Value, json};

use crate::models::{ActionSpec, ClusterEvent, OwnerRef, Suggestion};

/// Deterministic, evidence-based checks that run before any model is involved.
/// These are intentionally conservative: every mutation is tied to a concrete
/// signal from the pod status or its events, and destructive actions are only
/// proposed for standalone or evicted pods.
pub fn analyze_pod(pod: &Pod, events: &[ClusterEvent]) -> Vec<Suggestion> {
    let mut out = Vec::new();
    let meta = &pod.metadata;
    let namespace = meta.namespace.clone().unwrap_or_default();
    let name = meta.name.clone().unwrap_or_default();
    let owner = owner_from_pod(pod);
    let standalone = owner.kind == "Pod" || owner.standalone;
    let status = pod.status.as_ref();
    let spec = pod.spec.as_ref();
    let statuses = status
        .and_then(|s| s.container_statuses.as_ref())
        .cloned()
        .unwrap_or_default();
    let event_text = events
        .iter()
        .map(|e| format!("{}: {}", e.reason, e.message))
        .collect::<Vec<_>>()
        .join(" | ");
    let lower_events = event_text.to_ascii_lowercase();
    let deletion = meta.deletion_timestamp.is_some();
    let phase = status.and_then(|s| s.phase.clone()).unwrap_or_default();

    if deletion {
        return out;
    }

    // OOMKilled -----------------------------------------------------------
    let oom = statuses.iter().find(|s| {
        s.last_state
            .as_ref()
            .and_then(|l| l.terminated.as_ref())
            .and_then(|t| t.reason.as_deref())
            == Some("OOMKilled")
            || s.state
                .as_ref()
                .and_then(|l| l.terminated.as_ref())
                .and_then(|t| t.reason.as_deref())
                == Some("OOMKilled")
    });
    if let Some(cs) = oom {
        let container = spec.and_then(|s| s.containers.iter().find(|c| c.name == cs.name));
        let limit = container.and_then(memory_limit_bytes);
        let patch_count = meta
            .annotations
            .as_ref()
            .and_then(|a| a.get("healer.k8s.io/oom-patch-count"))
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(0);
        let mut evidence = vec![format!(
            "Container {} was OOMKilled (exit code {}).",
            cs.name,
            cs.last_state
                .as_ref()
                .and_then(|l| l.terminated.as_ref())
                .map(|t| t.exit_code)
                .unwrap_or(137)
        )];
        if let Some(bytes) = limit {
            evidence.push(format!(
                "Current memory limit: {}.",
                crate::models::format_bytes(bytes)
            ));
        }
        evidence.push(format!("{} restarts observed.", cs.restart_count));
        if let Some(e) = events
            .iter()
            .find(|e| e.message.to_ascii_lowercase().contains("oom"))
        {
            evidence.push(format!("Event {}: {}", e.reason, e.message));
        }

        if patch_count >= 3 {
            out.push(Suggestion {
                id: "oom-escalate".into(),
                kind: "diagnostic".into(),
                severity: "critical".into(),
                title: "OOM loop persists after repeated memory patches".into(),
                description: "This pod has already been patched three times. Raising the limit again is likely to hide a leak. Capture a heap profile or inspect the application's working set before changing resources.".into(),
                action: None,
                risk: "none".into(),
                safe: true,
                evidence,
            });
        } else if let Some(c) = container {
            if let Some(resources) = oom_resource_patch(c, 1024) {
                let owner_kind = if owner.kind == "Pod" {
                    "Pod"
                } else {
                    owner.kind.as_str()
                };
                let action = if owner_kind == "Pod" {
                    None
                } else {
                    Some(ActionSpec::PatchResources {
                        kind: owner_kind.to_string(),
                        namespace: namespace.clone(),
                        name: owner.name.clone(),
                        container: c.name.clone(),
                        resources: resources.clone(),
                    })
                };
                out.push(Suggestion {
                    id: "oom-patch-memory".into(),
                    kind: "remediation".into(),
                    severity: "critical".into(),
                    title: "Increase the memory limit for the OOM-killed container".into(),
                    description: format!(
                        "The kernel terminated {} because it exceeded its memory limit. A measured increase gives the process room while preserving a bound. Review recent heap growth before applying.",
                        c.name
                    ),
                    action,
                    risk: "medium".into(),
                    safe: true,
                    evidence,
                });
            } else {
                out.push(Suggestion {
                    id: "oom-no-limit".into(),
                    kind: "diagnostic".into(),
                    severity: "critical".into(),
                    title: "OOMKilled with no usable memory limit".into(),
                    description: "No memory limit was found on the container, or the limit is already at the safety ceiling. Inspect node pressure and the process working set before setting resources manually.".into(),
                    action: None,
                    risk: "none".into(),
                    safe: true,
                    evidence,
                });
            }
        }
    }

    // Crash loop ----------------------------------------------------------
    let crash = statuses.iter().find(|s| {
        s.state
            .as_ref()
            .and_then(|st| st.waiting.as_ref())
            .and_then(|w| w.reason.as_deref())
            == Some("CrashLoopBackOff")
            || s.restart_count >= 3
    });
    if let Some(cs) = crash {
        let last_exit = cs
            .last_state
            .as_ref()
            .and_then(|s| s.terminated.as_ref())
            .map(|t| (t.exit_code, t.reason.clone().unwrap_or_default()));
        let mut evidence = vec![format!(
            "Container {} has restarted {} times.",
            cs.name, cs.restart_count
        )];
        if let Some((code, reason)) = &last_exit {
            evidence.push(format!("Last termination: exit {code} ({reason})."));
        }
        if !event_text.is_empty() {
            evidence.push(truncate(&event_text, 400));
        }
        out.push(Suggestion {
            id: "crashloop-restart".into(),
            kind: "remediation".into(),
            severity: "critical".into(),
            title: (if standalone {
                "Delete this bare pod after capturing the crash evidence"
            } else {
                "Restart the workload after capturing the crash evidence"
            })
            .into(),
            description: (if standalone {
                "This pod has no controller. Deleting it will not recreate it; capture the previous logs and termination reason first. Use the Copilot for a root-cause hypothesis."
            } else {
                "The container is in a restart loop. A rolling restart clears transient state, but the previous logs and termination reason should be captured first. Use the Copilot for a root-cause hypothesis."
            })
            .into(),
            action: restart_or_delete(&owner, &namespace, &name),
            risk: "medium".into(),
            safe: true,
            evidence,
        });
        if cs.restart_count >= 10 {
            out.push(Suggestion {
                id: "crashloop-escalate".into(),
                kind: "diagnostic".into(),
                severity: "critical".into(),
                title: "Restart loop is not converging".into(),
                description: "More than ten restarts indicate a deterministic startup failure, not a transient fault. Inspect the last logs and the pod's configuration for missing secrets, bad arguments, or an unavailable dependency.".into(),
                action: None,
                risk: "none".into(),
                safe: true,
                evidence: vec![format!("{} restarts on {}.", cs.restart_count, cs.name)],
            });
        }
    }

    // Image pull ----------------------------------------------------------
    let image_pull = statuses.iter().find(|s| {
        s.state
            .as_ref()
            .and_then(|st| st.waiting.as_ref())
            .and_then(|w| w.reason.as_deref())
            .map(|r| r == "ImagePullBackOff" || r == "ErrImagePull" || r == "InvalidImageName")
            .unwrap_or(false)
    });
    if let Some(cs) = image_pull {
        let image = cs.image.clone();
        let mut evidence = vec![format!("Image: {image}")];
        if let Some(msg) = events
            .iter()
            .find(|e| e.reason.contains("Pull") || e.reason.contains("Image"))
        {
            evidence.push(format!("{}: {}", msg.reason, msg.message));
        }
        out.push(Suggestion {
            id: "image-pull".into(),
            kind: "diagnostic".into(),
            severity: "critical".into(),
            title: "The container image cannot be pulled".into(),
            description: "The kubelet cannot resolve or download this image. Check the registry credentials, the tag, and network egress. If the image tag is wrong, patch the workload with a known-good tag.".into(),
            action: None,
            risk: "none".into(),
            safe: true,
            evidence,
        });
    }

    // Config errors -------------------------------------------------------
    let config_error = statuses.iter().find(|s| {
        s.state
            .as_ref()
            .and_then(|st| st.waiting.as_ref())
            .and_then(|w| w.reason.as_deref())
            .map(|r| {
                matches!(
                    r,
                    "CreateContainerConfigError"
                        | "CreateContainerError"
                        | "RunContainerError"
                        | "InvalidImageName"
                )
            })
            .unwrap_or(false)
    });
    if let Some(cs) = config_error {
        let mut evidence = vec![format!("Container {} is waiting.", cs.name)];
        if let Some(msg) = events.iter().find(|e| {
            e.message.contains("secret")
                || e.message.contains("configmap")
                || e.message.contains("volume")
                || e.message.contains("not found")
        }) {
            evidence.push(format!("{}: {}", msg.reason, msg.message));
        }
        out.push(Suggestion {
            id: "config-error".into(),
            kind: "diagnostic".into(),
            severity: "critical".into(),
            title: "Container configuration is incomplete".into(),
            description: "The kubelet cannot build the container because a referenced Secret, ConfigMap, volume, or environment variable is missing. Reconcile the referenced object before restarting.".into(),
            action: None,
            risk: "none".into(),
            safe: true,
            evidence,
        });
    }

    // Pending / scheduling ------------------------------------------------
    if phase == "Pending" {
        let reason = status
            .and_then(|s| s.conditions.as_ref())
            .and_then(|cs| cs.iter().find(|c| c.type_ == "PodScheduled"))
            .and_then(|c| c.message.clone())
            .unwrap_or_default();
        let mut evidence = Vec::new();
        if !reason.is_empty() {
            evidence.push(reason);
        }
        if lower_events.contains("insufficient") {
            evidence.push("Events report insufficient allocatable resources.".into());
        }
        if lower_events.contains("taint") {
            evidence.push("Events report an untolerated node taint.".into());
        }
        if lower_events.contains("affinity") || lower_events.contains("selector") {
            evidence.push("Events report an unsatisfied node selector or affinity.".into());
        }
        out.push(Suggestion {
            id: "pending".into(),
            kind: "diagnostic".into(),
            severity: "warning".into(),
            title: "Pod is pending and has not been scheduled".into(),
            description: "The scheduler cannot place this pod. Inspect node capacity, taints, and affinity rules. Scaling the cluster or reducing requests may be required.".into(),
            action: None,
            risk: "none".into(),
            safe: true,
            evidence,
        });
    }

    // Evicted -------------------------------------------------------------
    if status.and_then(|s| s.reason.as_deref()) == Some("Evicted") {
        out.push(Suggestion {
            id: "evicted".into(),
            kind: "remediation".into(),
            severity: "critical".into(),
            title: "Pod was evicted by the node".into(),
            description: "The node reclaimed resources or the pod exceeded an eviction threshold. Deleting the evicted pod lets its controller reschedule it; investigate node pressure before doing so.".into(),
            action: Some(ActionSpec::DeletePod {
                namespace: namespace.clone(),
                name: name.clone(),
            }),
            risk: "low".into(),
            safe: true,
            evidence: events
                .iter()
                .filter(|e| e.reason == "Evicted")
                .map(|e| e.message.clone())
                .collect(),
        });
    }

    // Not ready / probes --------------------------------------------------
    if phase == "Running" {
        let not_ready = statuses.iter().filter(|s| !s.ready).count();
        if not_ready > 0 {
            let probe_events = events
                .iter()
                .filter(|e| {
                    e.message.contains("probe")
                        || e.message.contains("Readiness")
                        || e.message.contains("Liveness")
                })
                .map(|e| format!("{}: {}", e.reason, e.message))
                .collect::<Vec<_>>();
            out.push(Suggestion {
                id: "not-ready".into(),
                kind: "remediation".into(),
                severity: "warning".into(),
                title: (if standalone {
                    "Delete this bare pod to clear a stuck instance"
                } else {
                    "Running but failing readiness"
                })
                .into(),
                description: (if standalone {
                    "The pod has no controller. Deleting it will not recreate it; confirm the workload is managed elsewhere before proceeding."
                } else {
                    "The process is alive but not receiving traffic. A restart may clear a stuck dependency; if the probe is misconfigured, adjust its path, port, or thresholds instead."
                })
                .into(),
                action: restart_or_delete(&owner, &namespace, &name),
                risk: "low".into(),
                safe: true,
                evidence: {
                    let mut v = vec![format!("{not_ready} container(s) not ready.")];
                    v.extend(probe_events);
                    v
                },
            });
        }
    }

    // Generic failed state -------------------------------------------------
    if out.is_empty() && (phase == "Failed" || phase == "Unknown") {
        out.push(Suggestion {
            id: "failed-restart".into(),
            kind: "remediation".into(),
            severity: "critical".into(),
            title: (if standalone {
                "Delete this bare failed pod"
            } else {
                "Pod is in a failed state"
            })
            .into(),
            description: (if standalone {
                "The pod has no controller. Deleting it removes it permanently; capture the logs and termination details first."
            } else {
                "The pod cannot make progress. Restart the owning workload so a fresh pod is created, then inspect the new logs."
            })
            .into(),
            action: restart_or_delete(&owner, &namespace, &name),
            risk: "medium".into(),
            safe: true,
            evidence: events
                .iter()
                .filter(|e| e.r#type == "Warning")
                .take(4)
                .map(|e| format!("{}: {}", e.reason, e.message))
                .collect(),
        });
    }

    // Always surface a low-severity inspection path when there is any warning.
    if out.is_empty() && events.iter().any(|e| e.r#type == "Warning") {
        out.push(Suggestion {
            id: "inspect-warnings".into(),
            kind: "diagnostic".into(),
            severity: "warning".into(),
            title: "Warning events exist without a failed container".into(),
            description: "The pod is running, but recent warning events suggest instability. Read the event stream and ask the Copilot to correlate them with the logs.".into(),
            action: None,
            risk: "none".into(),
            safe: true,
            evidence: events
                .iter()
                .filter(|e| e.r#type == "Warning")
                .take(5)
                .map(|e| format!("{}: {}", e.reason, e.message))
                .collect(),
        });
    }

    out
}

fn restart_or_delete(owner: &OwnerRef, namespace: &str, pod_name: &str) -> Option<ActionSpec> {
    if owner.kind == "Pod" || owner.standalone {
        return Some(ActionSpec::DeletePod {
            namespace: namespace.to_string(),
            name: pod_name.to_string(),
        });
    }
    if matches!(
        owner.kind.as_str(),
        "Deployment" | "StatefulSet" | "DaemonSet"
    ) {
        return Some(ActionSpec::RestartWorkload {
            kind: owner.kind.clone(),
            namespace: namespace.to_string(),
            name: owner.name.clone(),
        });
    }
    None
}

fn owner_from_pod(pod: &Pod) -> OwnerRef {
    let namespace = pod.metadata.namespace.clone().unwrap_or_default();
    let name = pod.metadata.name.clone().unwrap_or_default();
    let owner = pod
        .metadata
        .owner_references
        .as_ref()
        .and_then(|o| o.first());
    match owner {
        None => OwnerRef {
            kind: "Pod".into(),
            name: name.clone(),
            namespace,
            standalone: true,
            immediate_kind: "Pod".into(),
            immediate_name: name,
            protected: crate::kube_client::is_protected_namespace(
                pod.metadata.namespace.as_deref().unwrap_or_default(),
            ),
        },
        Some(o) => OwnerRef {
            kind: if o.kind == "ReplicaSet" {
                "Deployment".into()
            } else {
                o.kind.clone()
            },
            name: o.name.clone(),
            namespace,
            standalone: false,
            immediate_kind: o.kind.clone(),
            immediate_name: o.name.clone(),
            protected: false,
        },
    }
}

fn memory_limit_bytes(container: &Container) -> Option<f64> {
    container
        .resources
        .as_ref()
        .and_then(|r| r.limits.as_ref())
        .and_then(|l| l.get("memory"))
        .map(|q| crate::models::parse_memory_bytes(&q.0))
        .filter(|v| *v > 0.0)
}

fn oom_resource_patch(container: &Container, max_mi: i64) -> Option<Value> {
    let current_limit = memory_limit_bytes(container);
    let max_bytes = max_mi as f64 * 1024.0 * 1024.0;
    let new_limit = match current_limit {
        Some(v) if v >= max_bytes => return None,
        Some(v) => (v * 2.0).clamp(256.0 * 1024.0 * 1024.0, max_bytes),
        None => 512.0 * 1024.0 * 1024.0,
    };
    let new_limit_mi = (new_limit / (1024.0 * 1024.0)).round() as i64;
    let new_request_mi = (new_limit_mi / 2).max(64);

    let mut resources = container
        .resources
        .as_ref()
        .and_then(|r| serde_json::to_value(r).ok())
        .unwrap_or_else(|| json!({}));
    if !resources.is_object() {
        resources = json!({});
    }
    let obj = resources.as_object_mut()?;
    let limits = obj
        .entry("limits")
        .or_insert_with(|| json!({}))
        .as_object_mut()?;
    limits.insert("memory".into(), Value::String(format!("{new_limit_mi}Mi")));
    let requests = obj
        .entry("requests")
        .or_insert_with(|| json!({}))
        .as_object_mut()?;
    let current_request = container
        .resources
        .as_ref()
        .and_then(|r| r.requests.as_ref())
        .and_then(|r| r.get("memory"))
        .map(|q| crate::models::parse_memory_bytes(&q.0))
        .unwrap_or(0.0);
    if current_request <= 0.0 {
        requests.insert(
            "memory".into(),
            Value::String(format!("{new_request_mi}Mi")),
        );
    } else if current_request > new_limit {
        requests.insert("memory".into(), Value::String(format!("{new_limit_mi}Mi")));
    }
    Some(resources)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{cut}…")
}
