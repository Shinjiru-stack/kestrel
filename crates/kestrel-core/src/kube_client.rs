use std::collections::{BTreeMap, HashMap};
use std::time::Instant;

use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet};
use k8s_openapi::api::core::v1::{Container, ContainerStatus, ResourceRequirements};
use k8s_openapi::api::core::v1::{Event, Node, Pod};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::OwnerReference;
use kube::api::{Api, ApiResource, DeleteParams, DynamicObject, ListParams, Patch, PatchParams};
use kube::config::{KubeConfigOptions, Kubeconfig};
use kube::{Client, Config};
use serde_json::{Value, json};

use crate::healer;
use crate::models::*;

pub const PROTECTED_NAMESPACES: &[&str] = &["kube-system", "kube-public", "kube-node-lease"];

pub fn is_protected_namespace(namespace: &str) -> bool {
    PROTECTED_NAMESPACES.contains(&namespace)
}

#[derive(Clone)]
pub struct ClusterClient {
    pub client: Client,
    pub config: Config,
    pub kubeconfig_path: String,
    pub context: String,
    pub server: String,
    pub cluster_name: String,
}

impl std::fmt::Debug for ClusterClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ClusterClient")
            .field("context", &self.context)
            .field("server", &self.server)
            .field("cluster_name", &self.cluster_name)
            .finish()
    }
}

impl ClusterClient {
    pub async fn connect(kubeconfig_path: &str, context: &str) -> Result<Self> {
        let kc = if kubeconfig_path.trim().is_empty() {
            Kubeconfig::read().context("no kubeconfig found (set KUBECONFIG or choose a file)")?
        } else {
            Kubeconfig::read_from(kubeconfig_path.trim())
                .with_context(|| format!("could not read kubeconfig at {kubeconfig_path}"))?
        };
        let options = KubeConfigOptions {
            context: if context.trim().is_empty() {
                None
            } else {
                Some(context.trim().to_string())
            },
            ..Default::default()
        };
        let config = Config::from_custom_kubeconfig(kc, &options)
            .await
            .context("could not build a Kubernetes client from this kubeconfig")?;
        let client =
            Client::try_from(config.clone()).context("could not create Kubernetes client")?;
        let server = config.cluster_url.to_string();
        let context_name = if context.trim().is_empty() {
            config.cluster_url.host().unwrap_or("cluster").to_string()
        } else {
            context.to_string()
        };
        let mut me = Self {
            client,
            config,
            kubeconfig_path: kubeconfig_path.to_string(),
            context: context_name,
            server,
            cluster_name: String::new(),
        };
        let version = me
            .client
            .apiserver_version()
            .await
            .context("could not reach the Kubernetes API server")?;
        if me.cluster_name.is_empty() {
            me.cluster_name = version.git_version.clone();
        }
        Ok(me)
    }

    pub async fn probe(&self) -> Result<(String, u64)> {
        let start = Instant::now();
        let info = self.client.apiserver_version().await?;
        Ok((info.git_version, start.elapsed().as_millis() as u64))
    }

    pub async fn snapshot(&self) -> Result<ClusterSnapshot> {
        let start = Instant::now();
        let nodes_api: Api<Node> = Api::all(self.client.clone());
        let pods_api: Api<Pod> = Api::all(self.client.clone());
        let deploy_api: Api<Deployment> = Api::all(self.client.clone());
        let sts_api: Api<StatefulSet> = Api::all(self.client.clone());
        let ds_api: Api<DaemonSet> = Api::all(self.client.clone());
        let rs_api: Api<ReplicaSet> = Api::all(self.client.clone());
        let events_api: Api<Event> = Api::all(self.client.clone());

        let nodes_params = ListParams::default();
        let pods_params = ListParams::default();
        let deploy_params = ListParams::default();
        let sts_params = ListParams::default();
        let ds_params = ListParams::default();
        let rs_params = ListParams::default();
        let events_params = ListParams::default().limit(500);

        let nodes_fut = nodes_api.list(&nodes_params);
        let pods_fut = pods_api.list(&pods_params);
        let deploy_fut = deploy_api.list(&deploy_params);
        let sts_fut = sts_api.list(&sts_params);
        let ds_fut = ds_api.list(&ds_params);
        let rs_fut = rs_api.list(&rs_params);
        let events_fut = events_api.list(&events_params);

        let (nodes_res, pods_res, deploy_res, sts_res, ds_res, rs_res, events_res) = tokio::join!(
            nodes_fut, pods_fut, deploy_fut, sts_fut, ds_fut, rs_fut, events_fut
        );

        let nodes = nodes_res.map(|l| l.items).unwrap_or_default();
        let pods = pods_res.map(|l| l.items).unwrap_or_default();
        let deployments = deploy_res.map(|l| l.items).unwrap_or_default();
        let statefulsets = sts_res.map(|l| l.items).unwrap_or_default();
        let daemonsets = ds_res.map(|l| l.items).unwrap_or_default();
        let replicasets = rs_res.map(|l| l.items).unwrap_or_default();
        let events = events_res.map(|l| l.items).unwrap_or_default();

        let metrics = self.fetch_metrics().await.unwrap_or_default();
        let rs_to_deploy = build_replicaset_owner_map(&replicasets);
        let pod_count_by_node = count_pods_by_node(&pods);

        let node_summaries: Vec<NodeSummary> = nodes
            .iter()
            .map(|n| node_to_summary(n, &metrics, &pod_count_by_node))
            .collect();

        let pod_summaries: Vec<PodSummary> = pods
            .iter()
            .map(|p| pod_to_summary(p, &rs_to_deploy, &metrics))
            .collect();

        let workloads = build_workloads(&deployments, &statefulsets, &daemonsets);
        let namespaces = build_namespaces(&pod_summaries);
        let mut event_summaries: Vec<ClusterEvent> = events.iter().map(event_to_summary).collect();
        event_summaries.sort_by_key(|e| std::cmp::Reverse(e.age_seconds));
        event_summaries.truncate(250);

        let first_node = node_summaries.first();
        let version = first_node
            .map(|n| n.version.clone())
            .unwrap_or_else(|| "unknown".to_string());
        let provider = if version.contains("k3s") {
            "k3s".to_string()
        } else if version.contains("eks") {
            "eks".to_string()
        } else if version.contains("gke") {
            "gke".to_string()
        } else if version.contains("aks") {
            "aks".to_string()
        } else {
            "kubernetes".to_string()
        };
        let cluster_name = first_node
            .map(|n| n.name.clone())
            .unwrap_or_else(|| self.cluster_name.clone());
        let latency = start.elapsed().as_millis() as u64;

        Ok(ClusterSnapshot {
            cluster: ClusterInfo {
                name: cluster_name,
                version,
                provider,
                server: self.server.clone(),
                context: self.context.clone(),
                latency_ms: latency,
                connection: "connected".to_string(),
            },
            nodes: node_summaries,
            pods: pod_summaries,
            workloads,
            namespaces,
            events: event_summaries,
            metrics_available: metrics.available,
            generated_at: now_iso(),
        })
    }

    pub async fn pod_detail(&self, namespace: &str, name: &str) -> Result<PodDetail> {
        let pods_api: Api<Pod> = Api::namespaced(self.client.clone(), namespace);
        let pod = pods_api.get(name).await?;
        let events = self.pod_events(namespace, name).await.unwrap_or_default();
        let metrics = self.fetch_metrics().await.unwrap_or_default();
        let owner = self.pod_owner(namespace, name).await?;
        let summary = pod_to_summary(&pod, &HashMap::new(), &metrics);
        let suggestions = healer::analyze_pod(&pod, &events);
        let containers = pod
            .spec
            .as_ref()
            .map(|spec| {
                spec.containers
                    .iter()
                    .map(|c| container_detail(c, &pod, &summary))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let status = pod.status.as_ref();
        Ok(PodDetail {
            pod: summary,
            owner,
            conditions: status
                .and_then(|s| s.conditions.as_ref())
                .map(|cs| {
                    cs.iter()
                        .map(|c| Condition {
                            r#type: c.type_.clone(),
                            status: c.status.clone(),
                            reason: c.reason.clone().unwrap_or_default(),
                            message: c.message.clone().unwrap_or_default(),
                            last_transition_time: c
                                .last_transition_time
                                .as_ref()
                                .map(|t| t.0.to_string()),
                        })
                        .collect()
                })
                .unwrap_or_default(),
            containers,
            service_account: pod
                .spec
                .as_ref()
                .and_then(|s| s.service_account_name.clone())
                .unwrap_or_default(),
            restart_policy: pod
                .spec
                .as_ref()
                .map(|s| s.restart_policy.clone().unwrap_or_default())
                .unwrap_or_default(),
            qos_class: status.and_then(|s| s.qos_class.clone()).unwrap_or_default(),
            priority_class: pod
                .spec
                .as_ref()
                .and_then(|s| s.priority_class_name.clone())
                .unwrap_or_default(),
            pod_ip: status.and_then(|s| s.pod_ip.clone()).unwrap_or_default(),
            host_ip: status.and_then(|s| s.host_ip.clone()).unwrap_or_default(),
            node_name: pod
                .spec
                .as_ref()
                .and_then(|s| s.node_name.clone())
                .unwrap_or_default(),
            suggestions,
            events,
            labels: pod.metadata.labels.clone().unwrap_or_default(),
            annotations: pod.metadata.annotations.clone().unwrap_or_default(),
        })
    }

    pub async fn pod_owner(&self, namespace: &str, name: &str) -> Result<OwnerRef> {
        let pods_api: Api<Pod> = Api::namespaced(self.client.clone(), namespace);
        let pod = pods_api.get(name).await?;
        let owners = pod.metadata.owner_references.unwrap_or_default();
        let Some(owner) = owners.first() else {
            return Ok(OwnerRef {
                kind: "Pod".into(),
                name: name.into(),
                namespace: namespace.into(),
                standalone: true,
                immediate_kind: "Pod".into(),
                immediate_name: name.into(),
                protected: is_protected_namespace(namespace),
            });
        };
        if owner.kind == "ReplicaSet" {
            let rs_api: Api<ReplicaSet> = Api::namespaced(self.client.clone(), namespace);
            if let Ok(rs) = rs_api.get(&owner.name).await
                && let Some(rs_owner) = rs
                    .metadata
                    .owner_references
                    .as_ref()
                    .and_then(|o| o.first())
            {
                return Ok(OwnerRef {
                    kind: rs_owner.kind.clone(),
                    name: rs_owner.name.clone(),
                    namespace: namespace.into(),
                    standalone: false,
                    immediate_kind: "ReplicaSet".into(),
                    immediate_name: owner.name.clone(),
                    protected: is_protected_namespace(namespace),
                });
            }
        }
        Ok(OwnerRef {
            kind: owner.kind.clone(),
            name: owner.name.clone(),
            namespace: namespace.into(),
            standalone: false,
            immediate_kind: owner.kind.clone(),
            immediate_name: owner.name.clone(),
            protected: is_protected_namespace(namespace),
        })
    }

    pub async fn pod_events(&self, namespace: &str, name: &str) -> Result<Vec<ClusterEvent>> {
        let api: Api<Event> = Api::namespaced(self.client.clone(), namespace);
        let list = api
            .list(&ListParams::default().fields(&format!(
                "involvedObject.name={name},involvedObject.kind=Pod"
            )))
            .await?;
        let mut out: Vec<ClusterEvent> = list.items.iter().map(event_to_summary).collect();
        out.sort_by_key(|e| e.age_seconds);
        out.truncate(80);
        Ok(out)
    }

    pub async fn logs(
        &self,
        namespace: &str,
        name: &str,
        container: Option<String>,
        tail_lines: i64,
        previous: bool,
    ) -> LogResponse {
        let api: Api<Pod> = Api::namespaced(self.client.clone(), namespace);
        let params = kube::api::LogParams {
            container,
            tail_lines: Some(tail_lines.clamp(1, 2000)),
            previous,
            timestamps: true,
            ..Default::default()
        };
        match api.logs(name, &params).await {
            Ok(text) => {
                let mut lines: Vec<LogLine> = text
                    .lines()
                    .map(|line| {
                        let (timestamp, rest) = split_timestamp(line);
                        let level = detect_level(rest);
                        LogLine {
                            timestamp,
                            text: rest.to_string(),
                            level,
                        }
                    })
                    .collect();
                let truncated = lines.len() as i64 >= tail_lines.clamp(1, 2000);
                if lines.len() > 2000 {
                    lines.truncate(2000);
                }
                LogResponse {
                    container: params.container.unwrap_or_default(),
                    previous,
                    lines,
                    truncated,
                    error: None,
                }
            }
            Err(err) => LogResponse {
                container: String::new(),
                previous,
                lines: Vec::new(),
                truncated: false,
                error: Some(err.to_string()),
            },
        }
    }

    pub async fn security_reports(&self) -> Result<Vec<SecurityReport>> {
        let ar = ApiResource {
            group: "aquasecurity.github.io".into(),
            version: "v1alpha1".into(),
            api_version: "aquasecurity.github.io/v1alpha1".into(),
            kind: "VulnerabilityReport".into(),
            plural: "vulnerabilityreports".into(),
        };
        let api: Api<DynamicObject> = Api::all_with(self.client.clone(), &ar);
        match api.list(&ListParams::default().limit(1000)).await {
            Ok(list) => Ok(list
                .items
                .iter()
                .map(security_report_from_dynamic)
                .collect()),
            Err(kube::Error::Api(ae)) if ae.code == 404 => Ok(Vec::new()),
            Err(err) => Err(err.into()),
        }
    }

    pub async fn security_reports_for_workload(
        &self,
        namespace: &str,
        workload: &str,
    ) -> Result<Vec<SecurityReport>> {
        let ar = ApiResource {
            group: "aquasecurity.github.io".into(),
            version: "v1alpha1".into(),
            api_version: "aquasecurity.github.io/v1alpha1".into(),
            kind: "VulnerabilityReport".into(),
            plural: "vulnerabilityreports".into(),
        };
        let api: Api<DynamicObject> = Api::namespaced_with(self.client.clone(), namespace, &ar);
        match api.list(&ListParams::default().limit(1000)).await {
            Ok(list) => Ok(list
                .items
                .iter()
                .map(security_report_from_dynamic)
                .filter(|r| r.workload == workload)
                .collect()),
            Err(kube::Error::Api(ae)) if ae.code == 404 => Ok(Vec::new()),
            Err(err) => Err(err.into()),
        }
    }

    async fn fetch_metrics(&self) -> Result<ClusterMetrics> {
        let pod_ar = ApiResource {
            group: "metrics.k8s.io".into(),
            version: "v1beta1".into(),
            api_version: "metrics.k8s.io/v1beta1".into(),
            kind: "PodMetrics".into(),
            plural: "pods".into(),
        };
        let node_ar = ApiResource {
            group: "metrics.k8s.io".into(),
            version: "v1beta1".into(),
            api_version: "metrics.k8s.io/v1beta1".into(),
            kind: "NodeMetrics".into(),
            plural: "nodes".into(),
        };
        let pod_api: Api<DynamicObject> = Api::all_with(self.client.clone(), &pod_ar);
        let node_api: Api<DynamicObject> = Api::all_with(self.client.clone(), &node_ar);
        let pod_params = ListParams::default().limit(5000);
        let node_params = ListParams::default().limit(500);
        let (pod_res, node_res) =
            tokio::join!(pod_api.list(&pod_params), node_api.list(&node_params));
        let mut out = ClusterMetrics::default();
        if let Ok(list) = pod_res {
            for item in list.items {
                let ns = item.metadata.namespace.clone().unwrap_or_default();
                let name = item.metadata.name.clone().unwrap_or_default();
                let key = format!("{ns}/{name}");
                let mut cpu = 0.0;
                let mut mem = 0.0;
                if let Some(containers) = item.data.get("containers").and_then(Value::as_array) {
                    for c in containers {
                        if let Some(usage) = c.get("usage") {
                            cpu += usage
                                .get("cpu")
                                .and_then(Value::as_str)
                                .map(parse_cpu_quantity)
                                .unwrap_or(0.0);
                            mem += usage
                                .get("memory")
                                .and_then(Value::as_str)
                                .map(parse_memory_bytes)
                                .unwrap_or(0.0);
                        }
                    }
                }
                out.pod_cpu.insert(key.clone(), cpu);
                out.pod_memory.insert(key, mem);
            }
            out.available = true;
        }
        if let Ok(list) = node_res {
            for item in list.items {
                let name = item.metadata.name.clone().unwrap_or_default();
                if let Some(usage) = item.data.get("usage") {
                    out.node_cpu.insert(
                        name.clone(),
                        usage
                            .get("cpu")
                            .and_then(Value::as_str)
                            .map(parse_cpu_quantity)
                            .unwrap_or(0.0),
                    );
                    out.node_memory.insert(
                        name,
                        usage
                            .get("memory")
                            .and_then(Value::as_str)
                            .map(parse_memory_bytes)
                            .unwrap_or(0.0),
                    );
                }
            }
            out.available = true;
        }
        Ok(out)
    }

    // ------------------------------------------------------------------
    // Mutations
    // ------------------------------------------------------------------

    fn guard(namespace: &str) -> Result<()> {
        if is_protected_namespace(namespace) {
            return Err(anyhow!(
                "namespace {namespace} is protected; mutations are blocked"
            ));
        }
        Ok(())
    }

    pub async fn restart_workload(
        &self,
        kind: &str,
        namespace: &str,
        name: &str,
    ) -> Result<String> {
        Self::guard(namespace)?;
        let stamp = Utc::now().to_rfc3339();
        match kind {
            "Deployment" => {
                let api: Api<Deployment> = Api::namespaced(self.client.clone(), namespace);
                let patch = json!({
                    "spec": { "template": { "metadata": { "annotations": {
                        "kubectl.kubernetes.io/restartedAt": stamp,
                        "healer.k8s.io/restarted-by": "kestrel"
                    }}}}
                });
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            "StatefulSet" => {
                let api: Api<StatefulSet> = Api::namespaced(self.client.clone(), namespace);
                let patch = json!({
                    "spec": { "template": { "metadata": { "annotations": {
                        "kubectl.kubernetes.io/restartedAt": stamp,
                        "healer.k8s.io/restarted-by": "kestrel"
                    }}}}
                });
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            "DaemonSet" => {
                let api: Api<DaemonSet> = Api::namespaced(self.client.clone(), namespace);
                let patch = json!({
                    "spec": { "template": { "metadata": { "annotations": {
                        "kubectl.kubernetes.io/restartedAt": stamp,
                        "healer.k8s.io/restarted-by": "kestrel"
                    }}}}
                });
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            other => return Err(anyhow!("restart is not supported for {other}")),
        }
        Ok(format!("{kind} {namespace}/{name} restarted"))
    }

    pub async fn delete_pod(&self, namespace: &str, name: &str) -> Result<String> {
        Self::guard(namespace)?;
        let api: Api<Pod> = Api::namespaced(self.client.clone(), namespace);
        api.delete(name, &DeleteParams::default()).await?;
        Ok(format!("Pod {namespace}/{name} deleted"))
    }

    pub async fn patch_image(
        &self,
        kind: &str,
        namespace: &str,
        name: &str,
        container: &str,
        image: &str,
    ) -> Result<String> {
        Self::guard(namespace)?;
        match kind {
            "Deployment" => {
                let api: Api<Deployment> = Api::namespaced(self.client.clone(), namespace);
                let obj = api.get(name).await?;
                let spec = obj.spec.as_ref().context("deployment has no spec")?;
                let pod_spec = spec
                    .template
                    .spec
                    .as_ref()
                    .context("template has no pod spec")?;
                let containers = patch_container_image(&pod_spec.containers, container, image)?;
                let patch = json!({"spec":{"template":{"spec":{"containers":containers}}}});
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            "StatefulSet" => {
                let api: Api<StatefulSet> = Api::namespaced(self.client.clone(), namespace);
                let obj = api.get(name).await?;
                let spec = obj.spec.as_ref().context("statefulset has no spec")?;
                let pod_spec = spec
                    .template
                    .spec
                    .as_ref()
                    .context("template has no pod spec")?;
                let containers = patch_container_image(&pod_spec.containers, container, image)?;
                let patch = json!({"spec":{"template":{"spec":{"containers":containers}}}});
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            "DaemonSet" => {
                let api: Api<DaemonSet> = Api::namespaced(self.client.clone(), namespace);
                let obj = api.get(name).await?;
                let spec = obj.spec.as_ref().context("daemonset has no spec")?;
                let pod_spec = spec
                    .template
                    .spec
                    .as_ref()
                    .context("template has no pod spec")?;
                let containers = patch_container_image(&pod_spec.containers, container, image)?;
                let patch = json!({"spec":{"template":{"spec":{"containers":containers}}}});
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            "Pod" => {
                let api: Api<Pod> = Api::namespaced(self.client.clone(), namespace);
                let obj = api.get(name).await?;
                let containers = patch_container_image(
                    &obj.spec
                        .as_ref()
                        .map(|s| s.containers.clone())
                        .unwrap_or_default(),
                    container,
                    image,
                )?;
                let patch = json!({"spec":{"containers":containers}});
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            other => return Err(anyhow!("image patch is not supported for {other}")),
        }
        Ok(format!("Image for {container} set to {image}"))
    }

    pub async fn patch_resources(
        &self,
        kind: &str,
        namespace: &str,
        name: &str,
        container: &str,
        resources: Value,
    ) -> Result<String> {
        Self::guard(namespace)?;
        match kind {
            "Deployment" => {
                let api: Api<Deployment> = Api::namespaced(self.client.clone(), namespace);
                let obj = api.get(name).await?;
                let spec = obj.spec.as_ref().context("deployment has no spec")?;
                let pod_spec = spec
                    .template
                    .spec
                    .as_ref()
                    .context("template has no pod spec")?;
                let (containers, annotations) = patch_container_resources(
                    &pod_spec.containers,
                    container,
                    resources,
                    spec.template.metadata.as_ref(),
                )?;
                let patch = json!({"spec":{"template":{"metadata":{"annotations":annotations},"spec":{"containers":containers}}}});
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            "StatefulSet" => {
                let api: Api<StatefulSet> = Api::namespaced(self.client.clone(), namespace);
                let obj = api.get(name).await?;
                let spec = obj.spec.as_ref().context("statefulset has no spec")?;
                let pod_spec = spec
                    .template
                    .spec
                    .as_ref()
                    .context("template has no pod spec")?;
                let (containers, annotations) = patch_container_resources(
                    &pod_spec.containers,
                    container,
                    resources,
                    spec.template.metadata.as_ref(),
                )?;
                let patch = json!({"spec":{"template":{"metadata":{"annotations":annotations},"spec":{"containers":containers}}}});
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            "DaemonSet" => {
                let api: Api<DaemonSet> = Api::namespaced(self.client.clone(), namespace);
                let obj = api.get(name).await?;
                let spec = obj.spec.as_ref().context("daemonset has no spec")?;
                let pod_spec = spec
                    .template
                    .spec
                    .as_ref()
                    .context("template has no pod spec")?;
                let (containers, annotations) = patch_container_resources(
                    &pod_spec.containers,
                    container,
                    resources,
                    spec.template.metadata.as_ref(),
                )?;
                let patch = json!({"spec":{"template":{"metadata":{"annotations":annotations},"spec":{"containers":containers}}}});
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            "Pod" => {
                return Err(anyhow!(
                    "Kubernetes does not allow patching resources on a standalone Pod; delete and recreate it"
                ));
            }
            other => return Err(anyhow!("resource patch is not supported for {other}")),
        }
        Ok(format!("Resources updated for {container}"))
    }

    pub async fn scale_workload(
        &self,
        kind: &str,
        namespace: &str,
        name: &str,
        replicas: i32,
    ) -> Result<String> {
        Self::guard(namespace)?;
        let patch = json!({"spec":{"replicas":replicas}});
        match kind {
            "Deployment" => {
                let api: Api<Deployment> = Api::namespaced(self.client.clone(), namespace);
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            "StatefulSet" => {
                let api: Api<StatefulSet> = Api::namespaced(self.client.clone(), namespace);
                api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
                    .await?;
            }
            other => return Err(anyhow!("scaling is not supported for {other}")),
        }
        Ok(format!("Scaled {kind} {namespace}/{name} to {replicas}"))
    }

    pub async fn apply_action(&self, action: &ActionSpec) -> Result<String> {
        match action {
            ActionSpec::RestartWorkload {
                kind,
                namespace,
                name,
            } => self.restart_workload(kind, namespace, name).await,
            ActionSpec::DeletePod { namespace, name } => self.delete_pod(namespace, name).await,
            ActionSpec::PatchImage {
                kind,
                namespace,
                name,
                container,
                image,
            } => {
                self.patch_image(kind, namespace, name, container, image)
                    .await
            }
            ActionSpec::PatchResources {
                kind,
                namespace,
                name,
                container,
                resources,
            } => {
                self.patch_resources(kind, namespace, name, container, resources.clone())
                    .await
            }
            ActionSpec::ScaleWorkload {
                kind,
                namespace,
                name,
                replicas,
            } => self.scale_workload(kind, namespace, name, *replicas).await,
            ActionSpec::RollbackDeployment { .. } => Err(anyhow!(
                "rollback is not enabled in this build; use restart or patch image"
            )),
        }
    }
}

fn build_replicaset_owner_map(replicasets: &[ReplicaSet]) -> HashMap<String, (String, String)> {
    let mut map = HashMap::new();
    for rs in replicasets {
        let rs_name = rs.metadata.name.clone().unwrap_or_default();
        let rs_uid = rs.metadata.uid.clone().unwrap_or_default();
        if let Some(owner) = rs
            .metadata
            .owner_references
            .as_ref()
            .and_then(|o| o.first())
            && owner.kind == "Deployment"
        {
            map.insert(rs_uid, (owner.name.clone(), rs_name));
        }
    }
    map
}

fn count_pods_by_node(pods: &[Pod]) -> HashMap<String, i64> {
    let mut map = HashMap::new();
    for pod in pods {
        if let Some(node) = pod.spec.as_ref().and_then(|s| s.node_name.as_ref()) {
            *map.entry(node.clone()).or_insert(0) += 1;
        }
    }
    map
}

fn node_to_summary(
    node: &Node,
    metrics: &ClusterMetrics,
    pod_count_by_node: &HashMap<String, i64>,
) -> NodeSummary {
    let meta = &node.metadata;
    let status = node.status.as_ref();
    let conditions = status
        .and_then(|s| s.conditions.as_ref())
        .map(|cs| {
            cs.iter()
                .map(|c| Condition {
                    r#type: c.type_.clone(),
                    status: c.status.clone(),
                    reason: c.reason.clone().unwrap_or_default(),
                    message: c.message.clone().unwrap_or_default(),
                    last_transition_time: c.last_transition_time.as_ref().map(|t| t.0.to_string()),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let ready = conditions
        .iter()
        .find(|c| c.r#type == "Ready")
        .map(|c| c.status == "True")
        .unwrap_or(false);
    let capacity = status.and_then(|s| s.capacity.clone()).unwrap_or_default();
    let cpu_capacity = capacity.get("cpu").map(|q| q.0.clone()).unwrap_or_default();
    let memory_capacity = capacity
        .get("memory")
        .map(|q| q.0.clone())
        .unwrap_or_default();
    let pod_capacity = capacity
        .get("pods")
        .and_then(|q| q.0.parse::<i64>().ok())
        .unwrap_or(0);
    let cpu_cores = parse_cpu_quantity(&cpu_capacity);
    let memory_bytes = parse_memory_bytes(&memory_capacity);
    let labels = meta.labels.clone().unwrap_or_default();
    let mut roles: Vec<String> = labels
        .keys()
        .filter_map(|k| k.strip_prefix("node-role.kubernetes.io/"))
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .collect();
    if roles.is_empty() {
        roles.push("worker".into());
    }
    let internal_ip = status
        .and_then(|s| s.addresses.as_ref())
        .and_then(|addrs| {
            addrs
                .iter()
                .find(|a| a.type_ == "InternalIP")
                .map(|a| a.address.clone())
        })
        .unwrap_or_default();
    let node_name = meta.name.clone().unwrap_or_default();
    let cpu_usage = metrics.node_cpu.get(&node_name).copied();
    let memory_usage = metrics.node_memory.get(&node_name).copied();
    NodeSummary {
        name: node_name.clone(),
        status: if ready { "Ready" } else { "NotReady" }.into(),
        roles,
        version: status
            .and_then(|s| s.node_info.as_ref())
            .map(|n| n.kubelet_version.clone())
            .unwrap_or_default(),
        os: status
            .and_then(|s| s.node_info.as_ref())
            .map(|n| n.operating_system.clone())
            .unwrap_or_default(),
        arch: status
            .and_then(|s| s.node_info.as_ref())
            .map(|n| n.architecture.clone())
            .unwrap_or_default(),
        internal_ip,
        age_seconds: age_seconds(meta.creation_timestamp.as_ref().map(|t| &t.0)),
        pods: *pod_count_by_node.get(&node_name).unwrap_or(&0),
        pod_capacity,
        cpu_capacity,
        memory_capacity,
        cpu_cores,
        memory_bytes,
        cpu_usage,
        memory_usage,
        conditions,
        taints: node
            .spec
            .as_ref()
            .and_then(|s| s.taints.as_ref())
            .map(|ts| {
                ts.iter()
                    .map(|t| {
                        format!(
                            "{}{}:{}",
                            t.key,
                            t.value
                                .as_ref()
                                .map(|v| format!("={v}"))
                                .unwrap_or_default(),
                            t.effect
                        )
                    })
                    .collect()
            })
            .unwrap_or_default(),
        labels,
    }
}

fn pod_to_summary(
    pod: &Pod,
    rs_to_deploy: &HashMap<String, (String, String)>,
    metrics: &ClusterMetrics,
) -> PodSummary {
    let meta = &pod.metadata;
    let ns = meta.namespace.clone().unwrap_or_default();
    let name = meta.name.clone().unwrap_or_default();
    let (phase, reason, ready, health_sev) = status_from_pod(pod);
    let (health, severity) = health_sev
        .split_once('|')
        .map(|(h, s)| (h.to_string(), s.to_string()))
        .unwrap_or_else(|| ("warning".into(), "warning".into()));
    let statuses = pod
        .status
        .as_ref()
        .and_then(|s| s.container_statuses.as_ref())
        .cloned()
        .unwrap_or_default();
    let containers: Vec<ContainerBrief> = statuses
        .iter()
        .map(|cs| {
            let (state, reason, last_reason) = container_state_strings(cs);
            ContainerBrief {
                name: cs.name.clone(),
                image: cs.image.clone(),
                ready: cs.ready,
                restarts: cs.restart_count,
                state,
                reason,
                last_reason,
            }
        })
        .collect();
    let owner = meta
        .owner_references
        .as_ref()
        .and_then(|o| o.first())
        .map(|o| owner_ref_from(o, &ns, rs_to_deploy));
    let key = format!("{ns}/{name}");
    PodSummary {
        uid: meta.uid.clone().unwrap_or_default(),
        namespace: ns,
        name,
        phase,
        status: if reason.is_empty() {
            String::new()
        } else {
            reason.clone()
        },
        reason,
        ready,
        restarts: statuses.iter().map(|s| s.restart_count).sum(),
        node: pod
            .spec
            .as_ref()
            .and_then(|s| s.node_name.clone())
            .unwrap_or_default(),
        age_seconds: age_seconds(meta.creation_timestamp.as_ref().map(|t| &t.0)),
        created_at: ts_string(meta.creation_timestamp.as_ref().map(|t| &t.0)),
        owner,
        labels: meta.labels.clone().unwrap_or_default(),
        containers,
        images: pod
            .spec
            .as_ref()
            .map(|s| {
                s.containers
                    .iter()
                    .map(|c| c.image.clone().unwrap_or_default())
                    .collect()
            })
            .unwrap_or_default(),
        cpu_usage: metrics.pod_cpu.get(&key).copied(),
        memory_usage: metrics.pod_memory.get(&key).copied(),
        health,
        severity,
    }
}

fn owner_ref_from(
    owner: &OwnerReference,
    namespace: &str,
    rs_to_deploy: &HashMap<String, (String, String)>,
) -> OwnerRef {
    if owner.kind == "ReplicaSet"
        && let Some((deploy, rs_name)) = rs_to_deploy.get(&owner.uid)
    {
        return OwnerRef {
            kind: "Deployment".into(),
            name: deploy.clone(),
            namespace: namespace.into(),
            standalone: false,
            immediate_kind: "ReplicaSet".into(),
            immediate_name: rs_name.clone(),
            protected: is_protected_namespace(namespace),
        };
    }
    OwnerRef {
        kind: owner.kind.clone(),
        name: owner.name.clone(),
        namespace: namespace.into(),
        standalone: false,
        immediate_kind: owner.kind.clone(),
        immediate_name: owner.name.clone(),
        protected: is_protected_namespace(namespace),
    }
}

fn build_workloads(
    deployments: &[Deployment],
    statefulsets: &[StatefulSet],
    daemonsets: &[DaemonSet],
) -> Vec<WorkloadSummary> {
    let mut out = Vec::new();
    for d in deployments {
        let meta = &d.metadata;
        let spec = d.spec.as_ref();
        let status = d.status.as_ref();
        let desired = spec.and_then(|s| s.replicas).unwrap_or(1);
        let ready = status.and_then(|s| s.ready_replicas).unwrap_or(0);
        let updated = status.and_then(|s| s.updated_replicas).unwrap_or(0);
        let available = status.and_then(|s| s.available_replicas).unwrap_or(0);
        out.push(WorkloadSummary {
            kind: "Deployment".into(),
            namespace: meta.namespace.clone().unwrap_or_default(),
            name: meta.name.clone().unwrap_or_default(),
            desired,
            ready,
            updated,
            available,
            age_seconds: age_seconds(meta.creation_timestamp.as_ref().map(|t| &t.0)),
            images: spec
                .map(|s| {
                    s.template
                        .spec
                        .as_ref()
                        .map(|ps| {
                            ps.containers
                                .iter()
                                .map(|c| c.image.clone().unwrap_or_default())
                                .collect()
                        })
                        .unwrap_or_default()
                })
                .unwrap_or_default(),
            status: workload_status(desired, ready, updated, available),
            labels: meta.labels.clone().unwrap_or_default(),
        });
    }
    for s in statefulsets {
        let meta = &s.metadata;
        let spec = s.spec.as_ref();
        let status = s.status.as_ref();
        let desired = spec.and_then(|s| s.replicas).unwrap_or(1);
        let ready = status.and_then(|s| s.ready_replicas).unwrap_or(0);
        let updated = status.and_then(|s| s.updated_replicas).unwrap_or(0);
        let available = status.and_then(|s| s.current_replicas).unwrap_or(0);
        out.push(WorkloadSummary {
            kind: "StatefulSet".into(),
            namespace: meta.namespace.clone().unwrap_or_default(),
            name: meta.name.clone().unwrap_or_default(),
            desired,
            ready,
            updated,
            available,
            age_seconds: age_seconds(meta.creation_timestamp.as_ref().map(|t| &t.0)),
            images: spec
                .map(|s| {
                    s.template
                        .spec
                        .as_ref()
                        .map(|ps| {
                            ps.containers
                                .iter()
                                .map(|c| c.image.clone().unwrap_or_default())
                                .collect()
                        })
                        .unwrap_or_default()
                })
                .unwrap_or_default(),
            status: workload_status(desired, ready, updated, available),
            labels: meta.labels.clone().unwrap_or_default(),
        });
    }
    for d in daemonsets {
        let meta = &d.metadata;
        let spec = d.spec.as_ref();
        let status = d.status.as_ref();
        let desired = status.map(|s| s.desired_number_scheduled).unwrap_or(0);
        let ready = status.map(|s| s.number_ready).unwrap_or(0);
        let updated = status.and_then(|s| s.updated_number_scheduled).unwrap_or(0);
        let available = status.and_then(|s| s.number_available).unwrap_or(0);
        out.push(WorkloadSummary {
            kind: "DaemonSet".into(),
            namespace: meta.namespace.clone().unwrap_or_default(),
            name: meta.name.clone().unwrap_or_default(),
            desired,
            ready,
            updated,
            available,
            age_seconds: age_seconds(meta.creation_timestamp.as_ref().map(|t| &t.0)),
            images: spec
                .map(|s| {
                    s.template
                        .spec
                        .as_ref()
                        .map(|ps| {
                            ps.containers
                                .iter()
                                .map(|c| c.image.clone().unwrap_or_default())
                                .collect()
                        })
                        .unwrap_or_default()
                })
                .unwrap_or_default(),
            status: workload_status(desired, ready, updated, available),
            labels: meta.labels.clone().unwrap_or_default(),
        });
    }
    out.sort_by(|a, b| {
        a.namespace
            .cmp(&b.namespace)
            .then_with(|| a.name.cmp(&b.name))
    });
    out
}

fn workload_status(desired: i32, ready: i32, updated: i32, available: i32) -> String {
    if desired == 0 {
        "Scaled to zero".into()
    } else if ready >= desired && available >= desired {
        "Healthy".into()
    } else if ready == 0 {
        "Degraded".into()
    } else if updated < desired {
        "Progressing".into()
    } else {
        "Degraded".into()
    }
}

fn build_namespaces(pods: &[PodSummary]) -> Vec<NamespaceSummary> {
    let mut map: BTreeMap<String, NamespaceSummary> = BTreeMap::new();
    for pod in pods {
        let entry = map
            .entry(pod.namespace.clone())
            .or_insert_with(|| NamespaceSummary {
                name: pod.namespace.clone(),
                ..Default::default()
            });
        entry.pods += 1;
        match pod.health.as_str() {
            "healthy" => entry.healthy += 1,
            "failed" => entry.failed += 1,
            _ => entry.warning += 1,
        }
        if let Some(cpu) = pod.cpu_usage {
            *entry.cpu_usage.get_or_insert(0.0) += cpu;
        }
        if let Some(mem) = pod.memory_usage {
            *entry.memory_usage.get_or_insert(0.0) += mem;
        }
    }
    map.into_values().collect()
}

fn event_to_summary(e: &Event) -> ClusterEvent {
    let last: Option<&k8s_openapi::jiff::Timestamp> = e
        .last_timestamp
        .as_ref()
        .map(|t| &t.0)
        .or_else(|| e.event_time.as_ref().map(|t| &t.0))
        .or_else(|| e.first_timestamp.as_ref().map(|t| &t.0));
    ClusterEvent {
        id: e.metadata.uid.clone().unwrap_or_else(|| {
            format!(
                "{}-{}",
                e.metadata.namespace.clone().unwrap_or_default(),
                e.metadata.name.clone().unwrap_or_default()
            )
        }),
        r#type: e.type_.clone().unwrap_or_else(|| "Normal".into()),
        reason: e.reason.clone().unwrap_or_default(),
        message: e.message.clone().unwrap_or_default(),
        namespace: e.metadata.namespace.clone().unwrap_or_default(),
        involved_kind: e.involved_object.kind.clone().unwrap_or_default(),
        involved_name: e.involved_object.name.clone().unwrap_or_default(),
        count: e.count.unwrap_or(1),
        last_seen: ts_string(last),
        source: e
            .source
            .as_ref()
            .and_then(|s| s.component.clone())
            .or_else(|| e.reporting_component.clone())
            .unwrap_or_default(),
        age_seconds: age_seconds(last),
    }
}

fn container_state_strings(cs: &ContainerStatus) -> (String, String, String) {
    let state = cs.state.as_ref();
    let mut state_name = "unknown".to_string();
    let mut reason = String::new();
    if let Some(s) = state {
        if let Some(w) = &s.waiting {
            state_name = "waiting".into();
            reason = w.reason.clone().unwrap_or_default();
        } else if let Some(t) = &s.terminated {
            state_name = "terminated".into();
            reason = t.reason.clone().unwrap_or_default();
        } else if s.running.is_some() {
            state_name = "running".into();
        }
    }
    let last_reason = cs
        .last_state
        .as_ref()
        .and_then(|s| {
            s.terminated
                .as_ref()
                .and_then(|t| t.reason.clone())
                .or_else(|| s.waiting.as_ref().and_then(|w| w.reason.clone()))
        })
        .unwrap_or_default();
    (state_name, reason, last_reason)
}

fn container_detail(c: &Container, pod: &Pod, _summary: &PodSummary) -> ContainerDetail {
    let cs = pod
        .status
        .as_ref()
        .and_then(|s| s.container_statuses.as_ref())
        .and_then(|cs| cs.iter().find(|s| s.name == c.name));
    let (state, reason, last_reason) = cs
        .map(container_state_strings)
        .unwrap_or_else(|| ("unknown".into(), String::new(), String::new()));
    let (started_at, finished_at, exit_code) = cs
        .and_then(|s| s.state.as_ref())
        .map(|s| {
            if let Some(t) = &s.terminated {
                (
                    t.started_at.as_ref().map(|v| v.0.to_string()),
                    t.finished_at.as_ref().map(|v| v.0.to_string()),
                    Some(t.exit_code),
                )
            } else if let Some(r) = &s.running {
                (r.started_at.as_ref().map(|v| v.0.to_string()), None, None)
            } else {
                (None, None, None)
            }
        })
        .unwrap_or((None, None, None));
    let resources = serde_json::to_value(&c.resources).unwrap_or(Value::Null);
    ContainerDetail {
        name: c.name.clone(),
        image: c.image.clone().unwrap_or_default(),
        ready: cs.map(|s| s.ready).unwrap_or(false),
        restarts: cs.map(|s| s.restart_count).unwrap_or(0),
        state,
        reason,
        last_reason,
        started_at,
        finished_at,
        exit_code,
        resources,
        ports: c
            .ports
            .as_ref()
            .map(|ps| {
                ps.iter()
                    .map(|p| PortInfo {
                        name: p.name.clone().unwrap_or_default(),
                        container_port: p.container_port,
                        protocol: p.protocol.clone().unwrap_or_else(|| "TCP".into()),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        env: c
            .env
            .as_ref()
            .map(|env| {
                env.iter()
                    .map(|e| EnvVar {
                        name: e.name.clone(),
                        value: e.value.clone(),
                        source: e.value_from.as_ref().map(|_| "valueFrom".to_string()),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        command: c.command.clone().unwrap_or_default(),
        args: c.args.clone().unwrap_or_default(),
        volume_mounts: c
            .volume_mounts
            .as_ref()
            .map(|v| v.iter().map(|m| m.mount_path.clone()).collect())
            .unwrap_or_default(),
    }
}

fn patch_container_image(
    containers: &[Container],
    container: &str,
    image: &str,
) -> Result<Vec<Value>> {
    let mut values = Vec::new();
    let mut found = false;
    for c in containers {
        let mut v = serde_json::to_value(c)?;
        if c.name == container {
            v["image"] = Value::String(image.to_string());
            found = true;
        }
        values.push(v);
    }
    if !found {
        return Err(anyhow!("container {container} not found"));
    }
    Ok(values)
}

fn patch_container_resources(
    containers: &[Container],
    container: &str,
    resources: Value,
    template_meta: Option<&k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta>,
) -> Result<(Vec<Value>, BTreeMap<String, String>)> {
    let mut values = Vec::new();
    let mut found = false;
    for c in containers {
        let mut v = serde_json::to_value(c)?;
        if c.name == container {
            v["resources"] = resources.clone();
            found = true;
        }
        values.push(v);
    }
    if !found {
        return Err(anyhow!("container {container} not found"));
    }
    let mut annotations = template_meta
        .and_then(|m| m.annotations.clone())
        .unwrap_or_default();
    let count = annotations
        .get("healer.k8s.io/oom-patch-count")
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0)
        + 1;
    annotations.insert("healer.k8s.io/oom-patch-count".into(), count.to_string());
    Ok((values, annotations))
}

fn split_timestamp(line: &str) -> (Option<String>, &str) {
    if let Some((first, rest)) = line.split_once(' ')
        && first.contains('T')
        && (first.ends_with('Z') || first.contains('+'))
    {
        return (Some(first.to_string()), rest);
    }
    (None, line)
}

fn detect_level(line: &str) -> String {
    let upper = line.to_ascii_uppercase();
    if upper.contains("ERROR") || upper.contains("FATAL") || upper.contains("PANIC") {
        "error".into()
    } else if upper.contains("WARN") {
        "warn".into()
    } else if upper.contains("DEBUG") || upper.contains("TRACE") {
        "debug".into()
    } else {
        "info".into()
    }
}

fn security_report_from_dynamic(obj: &DynamicObject) -> SecurityReport {
    let labels = obj.metadata.labels.clone().unwrap_or_default();
    let summary = obj
        .data
        .get("report")
        .and_then(|r| r.get("summary"))
        .cloned()
        .unwrap_or(Value::Null);
    let vulnerabilities = obj
        .data
        .get("report")
        .and_then(|r| r.get("vulnerabilities"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|v| Vulnerability {
            id: v
                .get("vulnerabilityID")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            package: v
                .get("resource")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            version: v
                .get("installedVersion")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            severity: v
                .get("severity")
                .and_then(Value::as_str)
                .unwrap_or("UNKNOWN")
                .to_string(),
            title: v
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            fixed_version: v
                .get("fixedVersion")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        })
        .collect::<Vec<_>>();
    let mut summary_out = VulnerabilitySummary::default();
    if let Some(s) = summary.as_object() {
        summary_out.critical = s.get("criticalCount").and_then(Value::as_i64).unwrap_or(0);
        summary_out.high = s.get("highCount").and_then(Value::as_i64).unwrap_or(0);
        summary_out.medium = s.get("mediumCount").and_then(Value::as_i64).unwrap_or(0);
        summary_out.low = s.get("lowCount").and_then(Value::as_i64).unwrap_or(0);
        summary_out.unknown = s.get("unknownCount").and_then(Value::as_i64).unwrap_or(0);
    }
    SecurityReport {
        name: obj.metadata.name.clone().unwrap_or_default(),
        namespace: obj.metadata.namespace.clone().unwrap_or_default(),
        kind: labels
            .get("trivy-operator.resource.kind")
            .cloned()
            .unwrap_or_default(),
        workload: labels
            .get("trivy-operator.resource.name")
            .cloned()
            .unwrap_or_default(),
        container: labels
            .get("trivy-operator.container.name")
            .cloned()
            .unwrap_or_default(),
        summary: summary_out,
        vulnerabilities,
    }
}

#[allow(dead_code)]
fn resource_requirements_from_value(value: &Value) -> ResourceRequirements {
    serde_json::from_value(value.clone()).unwrap_or_default()
}
