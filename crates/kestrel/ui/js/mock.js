/* Realistic preview data for browser mode. The Tauri bridge replaces all of
   this with live cluster calls; nothing here touches a real cluster. */

import { deepClone, fmtBytes } from "./format.js";

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const NOW = Date.now();

const isoAgo = (seconds) => new Date(NOW - seconds * 1000).toISOString();
const uid = (s) => `mock-${s}`;

function owner(namespace, kind, name, immediateKind, immediateName) {
  return {
    kind,
    name,
    namespace,
    standalone: kind === "Pod",
    immediateKind: immediateKind || kind,
    immediateName: immediateName || name,
    protected: namespace.startsWith("kube-"),
  };
}

function container(name, image, opts = {}) {
  return {
    name,
    image,
    ready: opts.ready ?? false,
    restarts: opts.restarts ?? 0,
    state: opts.state ?? "running",
    reason: opts.reason ?? "",
    lastReason: opts.lastReason ?? "",
  };
}

function pod({
  namespace,
  name,
  phase = "Running",
  status = "",
  reason = "",
  ready = "1/1",
  restarts = 0,
  node = "worker-01",
  ageSeconds = HOUR,
  ownerKind = "Deployment",
  ownerName = name.replace(/-[a-z0-9]+-[a-z0-9]+$/, ""),
  image = "ghcr.io/acme/app:latest",
  health = "healthy",
  severity = "info",
  cpuUsage = 0.03,
  memoryUsage = 64 * 1024 * 1024,
  containers,
  labels = {},
}) {
  const cName = ownerName || name;
  return {
    uid: uid(name),
    namespace,
    name,
    phase,
    status,
    reason,
    ready,
    restarts,
    node,
    ageSeconds,
    createdAt: isoAgo(ageSeconds),
    owner: owner(namespace, ownerKind, ownerName),
    labels: { app: cName, ...labels },
    containers: containers || [
      container(cName, image, {
        ready: ready.split("/")[0] === ready.split("/")[1],
        restarts,
        state: health === "failed" ? "waiting" : "running",
        reason: reason || "",
      }),
    ],
    images: [image],
    cpuUsage,
    memoryUsage,
    health,
    severity,
  };
}

function node({
  name,
  roles = ["worker"],
  version = "v1.35.5+k3s1",
  status = "Ready",
  cpuCores = 8,
  memoryBytes = 16 * 1024 ** 3,
  cpuUsage = 1.2,
  memoryUsage = 5.2 * 1024 ** 3,
  pods = 8,
  podCapacity = 110,
  internalIp = "172.30.123.34",
  ageSeconds = 5 * DAY,
  taints = [],
}) {
  return {
    name,
    status,
    roles,
    version,
    os: "linux",
    arch: "amd64",
    internalIp,
    ageSeconds,
    pods,
    podCapacity,
    cpuCapacity: String(cpuCores),
    memoryCapacity: `${Math.round(memoryBytes / 1024 ** 3)}Gi`,
    cpuCores,
    memoryBytes,
    cpuUsage,
    memoryUsage,
    conditions: [
      { type: "Ready", status: status === "Ready" ? "True" : "False", reason: "", message: "", lastTransitionTime: isoAgo(ageSeconds) },
      { type: "MemoryPressure", status: "False", reason: "KubeletHasSufficientMemory", message: "kubelet has sufficient memory available" },
      { type: "DiskPressure", status: "False", reason: "KubeletHasNoDiskPressure", message: "kubelet has no disk pressure" },
      { type: "PIDPressure", status: "False", reason: "KubeletHasSufficientPID", message: "kubelet has sufficient PID available" },
    ],
    taints,
    labels: {
      "kubernetes.io/hostname": name,
      "node.kubernetes.io/instance-type": "k3s",
      ...(roles.includes("control-plane") ? { "node-role.kubernetes.io/control-plane": "true", "node-role.kubernetes.io/master": "true" } : {}),
    },
  };
}

function workload({ kind, namespace, name, desired, ready, updated, available, images, status, ageSeconds = DAY }) {
  return {
    kind,
    namespace,
    name,
    desired,
    ready,
    updated: updated ?? ready,
    available: available ?? ready,
    ageSeconds,
    images,
    status,
    labels: { app: name },
  };
}

function event({ type = "Warning", reason, message, namespace, kind, name, count = 1, ageSeconds = 60, source = "kubelet" }) {
  return {
    id: uid(`${namespace}-${name}-${reason}-${ageSeconds}`),
    type,
    reason,
    message,
    namespace,
    involvedKind: kind,
    involvedName: name,
    count,
    lastSeen: isoAgo(ageSeconds),
    source,
    ageSeconds,
  };
}

function history() {
  const out = [];
  for (let i = 35; i >= 0; i -= 1) {
    const t = NOW - i * 5 * 60 * 1000;
    const wave = Math.sin((35 - i) / 4.2) * 0.06 + Math.sin((35 - i) / 11) * 0.035;
    out.push({
      t,
      cpu: Math.max(0.18, 0.42 + wave + (i % 5) * 0.006),
      memory: Math.max(0.22, 0.48 + wave * 0.8 + (i % 7) * 0.004),
    });
  }
  return out;
}

const nodes = [
  node({
    name: "shinjiru",
    roles: ["control-plane", "master", "etcd"],
    cpuCores: 8,
    memoryBytes: 16 * 1024 ** 3,
    cpuUsage: 1.46,
    memoryUsage: 6.1 * 1024 ** 3,
    pods: 4,
    internalIp: "172.30.123.34",
    ageSeconds: 5 * DAY,
  }),
  node({
    name: "worker-01",
    roles: ["worker"],
    cpuCores: 4,
    memoryBytes: 8 * 1024 ** 3,
    cpuUsage: 2.28,
    memoryUsage: 5.7 * 1024 ** 3,
    pods: 7,
    internalIp: "172.30.123.35",
    ageSeconds: 5 * DAY,
  }),
  node({
    name: "worker-02",
    roles: ["worker"],
    cpuCores: 4,
    memoryBytes: 8 * 1024 ** 3,
    cpuUsage: 1.12,
    memoryUsage: 3.4 * 1024 ** 3,
    pods: 5,
    internalIp: "172.30.123.36",
    ageSeconds: 5 * DAY,
  }),
];

const pods = [
  pod({
    namespace: "broken-apps",
    name: "payment-api-7d9c8f6b5-2xk4q",
    phase: "Running",
    status: "CrashLoopBackOff",
    reason: "CrashLoopBackOff",
    ready: "0/1",
    restarts: 14,
    node: "worker-01",
    ageSeconds: 42 * MINUTE,
    ownerKind: "Deployment",
    ownerName: "payment-api",
    image: "ghcr.io/acme/payment-api:2.4.1",
    health: "failed",
    severity: "critical",
    cpuUsage: 0.06,
    memoryUsage: 118 * 1024 ** 2,
    containers: [
      container("payment-api", "ghcr.io/acme/payment-api:2.4.1", {
        ready: false,
        restarts: 14,
        state: "waiting",
        reason: "CrashLoopBackOff",
        lastReason: "Error",
      }),
    ],
  }),
  pod({
    namespace: "broken-apps",
    name: "checkout-worker-5b7d9c8f7d-9m2pl",
    phase: "Running",
    status: "OOMKilled",
    reason: "OOMKilled",
    ready: "0/1",
    restarts: 6,
    node: "worker-02",
    ageSeconds: 72 * MINUTE,
    ownerKind: "Deployment",
    ownerName: "checkout-worker",
    image: "ghcr.io/acme/checkout-worker:1.8.3",
    health: "failed",
    severity: "critical",
    cpuUsage: 0.13,
    memoryUsage: 498 * 1024 ** 2,
    containers: [
      container("checkout-worker", "ghcr.io/acme/checkout-worker:1.8.3", {
        ready: false,
        restarts: 6,
        state: "running",
        reason: "OOMKilled",
        lastReason: "OOMKilled",
      }),
    ],
  }),
  pod({
    namespace: "broken-apps",
    name: "inventory-sync-6f8c7d9b4-4vq2n",
    phase: "Pending",
    status: "ImagePullBackOff",
    reason: "ImagePullBackOff",
    ready: "0/1",
    restarts: 0,
    node: "worker-01",
    ageSeconds: 18 * MINUTE,
    ownerKind: "Deployment",
    ownerName: "inventory-sync",
    image: "registry.acme.io/inventory-sync:1.9.0",
    health: "failed",
    severity: "critical",
    cpuUsage: 0,
    memoryUsage: 0,
    containers: [
      container("inventory-sync", "registry.acme.io/inventory-sync:1.9.0", {
        ready: false,
        state: "waiting",
        reason: "ImagePullBackOff",
      }),
    ],
  }),
  pod({
    namespace: "demo-issues",
    name: "legacy-auth-0",
    phase: "Pending",
    status: "Unschedulable",
    reason: "Unschedulable",
    ready: "0/1",
    restarts: 0,
    node: "",
    ageSeconds: 7 * MINUTE,
    ownerKind: "StatefulSet",
    ownerName: "legacy-auth",
    image: "ghcr.io/acme/legacy-auth:0.9.7",
    health: "pending",
    severity: "warning",
    cpuUsage: 0,
    memoryUsage: 0,
    containers: [
      container("legacy-auth", "ghcr.io/acme/legacy-auth:0.9.7", {
        ready: false,
        state: "waiting",
        reason: "Unschedulable",
      }),
    ],
  }),
  pod({
    namespace: "demo-issues",
    name: "frontend-6b8f9d7c5-2j4kl",
    phase: "Running",
    ready: "1/1",
    node: "worker-01",
    ageSeconds: 3 * DAY,
    ownerKind: "Deployment",
    ownerName: "frontend",
    image: "ghcr.io/acme/frontend:3.2.0",
    health: "healthy",
    severity: "info",
    cpuUsage: 0.028,
    memoryUsage: 68 * 1024 ** 2,
    containers: [
      container("frontend", "ghcr.io/acme/frontend:3.2.0", { ready: true }),
      container("envoy", "envoyproxy/envoy:v1.31.0", { ready: true }),
    ],
  }),
  pod({
    namespace: "demo-issues",
    name: "frontend-6b8f9d7c5-8p5wz",
    phase: "Running",
    ready: "1/1",
    node: "worker-02",
    ageSeconds: 3 * DAY,
    ownerKind: "Deployment",
    ownerName: "frontend",
    image: "ghcr.io/acme/frontend:3.2.0",
    health: "healthy",
    severity: "info",
    cpuUsage: 0.031,
    memoryUsage: 71 * 1024 ** 2,
    containers: [
      container("frontend", "ghcr.io/acme/frontend:3.2.0", { ready: true }),
      container("envoy", "envoyproxy/envoy:v1.31.0", { ready: true }),
    ],
  }),
  pod({
    namespace: "demo-issues",
    name: "api-gateway-5f7c8d6b9-7h3qs",
    phase: "Running",
    ready: "1/1",
    restarts: 1,
    node: "worker-01",
    ageSeconds: 2 * DAY,
    ownerKind: "Deployment",
    ownerName: "api-gateway",
    image: "ghcr.io/acme/api-gateway:2.1.4",
    health: "healthy",
    severity: "info",
    cpuUsage: 0.044,
    memoryUsage: 112 * 1024 ** 2,
    containers: [
      container("api-gateway", "ghcr.io/acme/api-gateway:2.1.4", { ready: true, restarts: 1 }),
    ],
  }),
  pod({
    namespace: "demo-issues",
    name: "redis-cart-0",
    phase: "Running",
    ready: "1/1",
    node: "worker-02",
    ageSeconds: 4 * DAY,
    ownerKind: "StatefulSet",
    ownerName: "redis-cart",
    image: "redis:7.2-alpine",
    health: "healthy",
    severity: "info",
    cpuUsage: 0.012,
    memoryUsage: 42 * 1024 ** 2,
    containers: [container("redis", "redis:7.2-alpine", { ready: true })],
  }),
  pod({
    namespace: "demo-issues",
    name: "load-generator-7c9d8f6b5-3k2mn",
    phase: "Running",
    ready: "0/1",
    restarts: 2,
    node: "worker-02",
    ageSeconds: 9 * HOUR,
    ownerKind: "Deployment",
    ownerName: "load-generator",
    image: "ghcr.io/acme/load-generator:0.4.2",
    health: "warning",
    severity: "warning",
    cpuUsage: 0.21,
    memoryUsage: 94 * 1024 ** 2,
    containers: [
      container("load-generator", "ghcr.io/acme/load-generator:0.4.2", {
        ready: false,
        restarts: 2,
        state: "running",
        reason: "Readiness probe failed",
      }),
    ],
  }),
  pod({
    namespace: "demo-vulns",
    name: "old-nginx-6d8f7c9b5-5x9pl",
    phase: "Running",
    ready: "1/1",
    node: "worker-01",
    ageSeconds: 8 * DAY,
    ownerKind: "Deployment",
    ownerName: "old-nginx",
    image: "nginx:1.21.0",
    health: "healthy",
    severity: "info",
    cpuUsage: 0.009,
    memoryUsage: 24 * 1024 ** 2,
    containers: [container("nginx", "nginx:1.21.0", { ready: true })],
  }),
  pod({
    namespace: "demo-vulns",
    name: "old-redis-0",
    phase: "Running",
    ready: "1/1",
    node: "worker-02",
    ageSeconds: 8 * DAY,
    ownerKind: "StatefulSet",
    ownerName: "old-redis",
    image: "redis:6.0.8",
    health: "healthy",
    severity: "info",
    cpuUsage: 0.011,
    memoryUsage: 38 * 1024 ** 2,
    containers: [container("redis", "redis:6.0.8", { ready: true })],
  }),
  pod({
    namespace: "kube-system",
    name: "coredns-7d8f9c6b5-4nq2x",
    phase: "Running",
    ready: "1/1",
    node: "shinjiru",
    ageSeconds: 5 * DAY,
    ownerKind: "Deployment",
    ownerName: "coredns",
    image: "rancher/mirrored-coredns-coredns:1.12.0",
    health: "healthy",
    severity: "info",
    cpuUsage: 0.006,
    memoryUsage: 32 * 1024 ** 2,
    containers: [container("coredns", "rancher/mirrored-coredns-coredns:1.12.0", { ready: true })],
  }),
  pod({
    namespace: "kube-system",
    name: "local-path-provisioner-6c8d7f-2k9pl",
    phase: "Running",
    ready: "1/1",
    node: "shinjiru",
    ageSeconds: 5 * DAY,
    ownerKind: "Deployment",
    ownerName: "local-path-provisioner",
    image: "rancher/local-path-provisioner:v0.0.31",
    health: "healthy",
    severity: "info",
    cpuUsage: 0.002,
    memoryUsage: 18 * 1024 ** 2,
    containers: [container("local-path-provisioner", "rancher/local-path-provisioner:v0.0.31", { ready: true })],
  }),
  pod({
    namespace: "kube-system",
    name: "metrics-server-7b8c9d6f5-6h3qs",
    phase: "Running",
    ready: "1/1",
    node: "shinjiru",
    ageSeconds: 5 * DAY,
    ownerKind: "Deployment",
    ownerName: "metrics-server",
    image: "rancher/mirrored-metrics-server:v0.7.2",
    health: "healthy",
    severity: "info",
    cpuUsage: 0.008,
    memoryUsage: 28 * 1024 ** 2,
    containers: [container("metrics-server", "rancher/mirrored-metrics-server:v0.7.2", { ready: true })],
  }),
  pod({
    namespace: "kube-system",
    name: "traefik-5f7c8d9b6-8m2pl",
    phase: "Running",
    ready: "1/1",
    node: "shinjiru",
    ageSeconds: 5 * DAY,
    ownerKind: "Deployment",
    ownerName: "traefik",
    image: "rancher/mirrored-library-traefik:3.1.4",
    health: "healthy",
    severity: "info",
    cpuUsage: 0.014,
    memoryUsage: 54 * 1024 ** 2,
    containers: [container("traefik", "rancher/mirrored-library-traefik:3.1.4", { ready: true })],
  }),
  pod({
    namespace: "default",
    name: "hello-world-6f8d7c5b4-3j9pl",
    phase: "Running",
    ready: "1/1",
    node: "worker-02",
    ageSeconds: 2 * HOUR,
    ownerKind: "Deployment",
    ownerName: "hello-world",
    image: "nginxdemos/hello:plain-text",
    health: "healthy",
    severity: "info",
    cpuUsage: 0.001,
    memoryUsage: 8 * 1024 ** 2,
    containers: [container("hello-world", "nginxdemos/hello:plain-text", { ready: true })],
  }),
];

const workloads = [
  workload({ kind: "Deployment", namespace: "broken-apps", name: "payment-api", desired: 1, ready: 0, images: ["ghcr.io/acme/payment-api:2.4.1"], status: "Degraded", ageSeconds: 42 * MINUTE }),
  workload({ kind: "Deployment", namespace: "broken-apps", name: "checkout-worker", desired: 1, ready: 0, images: ["ghcr.io/acme/checkout-worker:1.8.3"], status: "Degraded", ageSeconds: 72 * MINUTE }),
  workload({ kind: "Deployment", namespace: "broken-apps", name: "inventory-sync", desired: 1, ready: 0, images: ["registry.acme.io/inventory-sync:1.9.0"], status: "Degraded", ageSeconds: 18 * MINUTE }),
  workload({ kind: "StatefulSet", namespace: "demo-issues", name: "legacy-auth", desired: 1, ready: 0, images: ["ghcr.io/acme/legacy-auth:0.9.7"], status: "Degraded", ageSeconds: 7 * MINUTE }),
  workload({ kind: "Deployment", namespace: "demo-issues", name: "frontend", desired: 2, ready: 2, images: ["ghcr.io/acme/frontend:3.2.0", "envoyproxy/envoy:v1.31.0"], status: "Healthy", ageSeconds: 3 * DAY }),
  workload({ kind: "Deployment", namespace: "demo-issues", name: "api-gateway", desired: 1, ready: 1, images: ["ghcr.io/acme/api-gateway:2.1.4"], status: "Healthy", ageSeconds: 2 * DAY }),
  workload({ kind: "Deployment", namespace: "demo-issues", name: "load-generator", desired: 1, ready: 1, images: ["ghcr.io/acme/load-generator:0.4.2"], status: "Healthy", ageSeconds: 9 * HOUR }),
  workload({ kind: "StatefulSet", namespace: "demo-issues", name: "redis-cart", desired: 1, ready: 1, images: ["redis:7.2-alpine"], status: "Healthy", ageSeconds: 4 * DAY }),
  workload({ kind: "Deployment", namespace: "demo-vulns", name: "old-nginx", desired: 1, ready: 1, images: ["nginx:1.21.0"], status: "Healthy", ageSeconds: 8 * DAY }),
  workload({ kind: "StatefulSet", namespace: "demo-vulns", name: "old-redis", desired: 1, ready: 1, images: ["redis:6.0.8"], status: "Healthy", ageSeconds: 8 * DAY }),
  workload({ kind: "Deployment", namespace: "kube-system", name: "coredns", desired: 1, ready: 1, images: ["rancher/mirrored-coredns-coredns:1.12.0"], status: "Healthy", ageSeconds: 5 * DAY }),
  workload({ kind: "Deployment", namespace: "kube-system", name: "local-path-provisioner", desired: 1, ready: 1, images: ["rancher/local-path-provisioner:v0.0.31"], status: "Healthy", ageSeconds: 5 * DAY }),
  workload({ kind: "Deployment", namespace: "kube-system", name: "metrics-server", desired: 1, ready: 1, images: ["rancher/mirrored-metrics-server:v0.7.2"], status: "Healthy", ageSeconds: 5 * DAY }),
  workload({ kind: "Deployment", namespace: "kube-system", name: "traefik", desired: 1, ready: 1, images: ["rancher/mirrored-library-traefik:3.1.4"], status: "Healthy", ageSeconds: 5 * DAY }),
  workload({ kind: "DaemonSet", namespace: "kube-system", name: "svclb-traefik", desired: 3, ready: 3, images: ["rancher/klipper-lb:v0.4.9"], status: "Healthy", ageSeconds: 5 * DAY }),
  workload({ kind: "Deployment", namespace: "default", name: "hello-world", desired: 1, ready: 1, images: ["nginxdemos/hello:plain-text"], status: "Healthy", ageSeconds: 2 * HOUR }),
];

const events = [
  event({ reason: "BackOff", message: "Back-off restarting failed container payment-api in pod payment-api-7d9c8f6b5-2xk4q_broken-apps", namespace: "broken-apps", kind: "Pod", name: "payment-api-7d9c8f6b5-2xk4q", count: 26, ageSeconds: 38, source: "kubelet" }),
  event({ reason: "Unhealthy", message: "Readiness probe failed: Get \"http://10.42.1.37:8080/ready\": dial tcp 10.42.1.37:8080: connect: connection refused", namespace: "broken-apps", kind: "Pod", name: "payment-api-7d9c8f6b5-2xk4q", count: 18, ageSeconds: 62, source: "kubelet" }),
  event({ reason: "OOMKilling", message: "Memory cgroup out of memory: Killed process 1 (node) total-vm:1048576kB, anon-rss:523776kB, file-rss:0kB", namespace: "broken-apps", kind: "Pod", name: "checkout-worker-5b7d9c8f7d-9m2pl", count: 6, ageSeconds: 190, source: "kernel" }),
  event({ reason: "Failed", message: "Failed to pull image \"registry.acme.io/inventory-sync:1.9.0\": rpc error: code = Unknown desc = failed to pull and unpack image: failed to resolve reference: 401 Unauthorized", namespace: "broken-apps", kind: "Pod", name: "inventory-sync-6f8c7d9b4-4vq2n", count: 12, ageSeconds: 240, source: "kubelet" }),
  event({ reason: "FailedScheduling", message: "0/3 nodes are available: 1 node(s) had untolerated taint {dedicated: auth}, 2 Insufficient memory. preemption: 0/3 nodes are available: 3 No preemption victims found.", namespace: "demo-issues", kind: "Pod", name: "legacy-auth-0", count: 9, ageSeconds: 300, source: "default-scheduler" }),
  event({ reason: "Pulling", message: "Pulling image \"ghcr.io/acme/frontend:3.2.0\"", namespace: "demo-issues", kind: "Pod", name: "frontend-6b8f9d7c5-8p5wz", count: 1, ageSeconds: 520, source: "kubelet" }),
  event({ reason: "Started", message: "Started container frontend", namespace: "demo-issues", kind: "Pod", name: "frontend-6b8f9d7c5-8p5wz", count: 1, ageSeconds: 518, source: "kubelet" }),
  event({ reason: "ReadinessProbeFailed", message: "Readiness probe failed: HTTP probe failed with statuscode: 503", namespace: "demo-issues", kind: "Pod", name: "load-generator-7c9d8f6b5-3k2mn", count: 4, ageSeconds: 610, source: "kubelet" }),
  event({ reason: "ScalingReplicaSet", message: "Scaled up replica set frontend-6b8f9d7c5 to 2", namespace: "demo-issues", kind: "Deployment", name: "frontend", count: 1, ageSeconds: 900, source: "deployment-controller" }),
  event({ reason: "Created", message: "Created pod: legacy-auth-0", namespace: "demo-issues", kind: "StatefulSet", name: "legacy-auth", count: 1, ageSeconds: 420, source: "statefulset-controller" }),
  event({ reason: "SuccessfulCreate", message: "Created container payment-api", namespace: "broken-apps", kind: "Pod", name: "payment-api-7d9c8f6b5-2xk4q", count: 1, ageSeconds: 2520, source: "kubelet" }),
  event({ reason: "NodeReady", message: "Node worker-02 status is now: NodeReady", namespace: "", kind: "Node", name: "worker-02", count: 1, ageSeconds: 5 * DAY, source: "kubelet" }),
];

const namespaces = [
  { name: "broken-apps", pods: 3, healthy: 0, warning: 0, failed: 3, cpuUsage: 0.19, memoryUsage: 616 * 1024 ** 2 },
  { name: "demo-issues", pods: 6, healthy: 4, warning: 1, failed: 1, cpuUsage: 0.31, memoryUsage: 401 * 1024 ** 2 },
  { name: "demo-vulns", pods: 2, healthy: 2, warning: 0, failed: 0, cpuUsage: 0.02, memoryUsage: 62 * 1024 ** 2 },
  { name: "default", pods: 1, healthy: 1, warning: 0, failed: 0, cpuUsage: 0.001, memoryUsage: 8 * 1024 ** 2 },
  { name: "kube-system", pods: 4, healthy: 4, warning: 0, failed: 0, cpuUsage: 0.03, memoryUsage: 132 * 1024 ** 2 },
];

const snapshot = {
  cluster: {
    name: "shinjiru",
    version: "v1.35.5+k3s1",
    provider: "k3s",
    server: "https://127.0.0.1:6443",
    context: "kestrel-demo",
    latencyMs: 24,
    connection: "connected",
  },
  nodes,
  pods,
  workloads,
  namespaces,
  events,
  metricsAvailable: true,
  generatedAt: new Date().toISOString(),
  history: history(),
};

const detailOverrides = {
  "broken-apps/payment-api-7d9c8f6b5-2xk4q": {
    conditions: [
      { type: "PodScheduled", status: "True", reason: "", message: "" },
      { type: "Initialized", status: "True", reason: "", message: "" },
      { type: "ContainersReady", status: "False", reason: "ContainersNotReady", message: "containers with unready status: [payment-api]" },
      { type: "Ready", status: "False", reason: "ContainersNotReady", message: "containers with unready status: [payment-api]" },
    ],
    containers: [
      {
        name: "payment-api",
        image: "ghcr.io/acme/payment-api:2.4.1",
        ready: false,
        restarts: 14,
        state: "waiting",
        reason: "CrashLoopBackOff",
        lastReason: "Error",
        startedAt: isoAgo(2 * HOUR),
        finishedAt: isoAgo(38),
        exitCode: 1,
        resources: {
          limits: { cpu: "500m", memory: "512Mi" },
          requests: { cpu: "250m", memory: "256Mi" },
        },
        ports: [{ name: "http", containerPort: 8080, protocol: "TCP" }],
        env: [
          { name: "DATABASE_URL", value: null, source: "secretKeyRef: payment-db" },
          { name: "LOG_LEVEL", value: "info" },
          { name: "PORT", value: "8080" },
          { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "http://otel-collector:4317" },
        ],
        command: ["node", "dist/server.js"],
        args: [],
        volumeMounts: ["/var/run/secrets/kubernetes.io/serviceaccount"],
      },
    ],
    suggestions: [
      {
        id: "crashloop-restart",
        kind: "remediation",
        severity: "critical",
        title: "Restart the workload after capturing the crash evidence",
        description: "The container is in a restart loop. A rolling restart clears transient state, but the previous logs and termination reason should be captured first.",
        action: { type: "restartWorkload", kind: "Deployment", namespace: "broken-apps", name: "payment-api" },
        risk: "medium",
        safe: true,
        evidence: ["Container payment-api has restarted 14 times.", "Last termination: exit 1 (Error).", "Readiness probe: connection refused on 10.42.1.37:8080."],
      },
      {
        id: "crashloop-escalate",
        kind: "diagnostic",
        severity: "critical",
        title: "Restart loop is not converging",
        description: "More than ten restarts indicate a deterministic startup failure, not a transient fault. Inspect the database migration path and the last 200 log lines before restarting.",
        action: null,
        risk: "none",
        safe: true,
        evidence: ["14 restarts on payment-api."],
      },
    ],
  },
  "broken-apps/checkout-worker-5b7d9c8f7d-9m2pl": {
    conditions: [
      { type: "PodScheduled", status: "True", reason: "", message: "" },
      { type: "Initialized", status: "True", reason: "", message: "" },
      { type: "ContainersReady", status: "False", reason: "ContainersNotReady", message: "containers with unready status: [checkout-worker]" },
      { type: "Ready", status: "False", reason: "ContainersNotReady", message: "containers with unready status: [checkout-worker]" },
    ],
    containers: [
      {
        name: "checkout-worker",
        image: "ghcr.io/acme/checkout-worker:1.8.3",
        ready: false,
        restarts: 6,
        state: "running",
        reason: "OOMKilled",
        lastReason: "OOMKilled",
        startedAt: isoAgo(12 * MINUTE),
        finishedAt: null,
        exitCode: 137,
        resources: {
          limits: { cpu: "1", memory: "512Mi" },
          requests: { cpu: "500m", memory: "384Mi" },
        },
        ports: [],
        env: [
          { name: "QUEUE_URL", value: "amqp://rabbitmq.demo-issues.svc:5672" },
          { name: "WORKER_CONCURRENCY", value: "8" },
          { name: "NODE_OPTIONS", value: "--max-old-space-size=768" },
        ],
        command: ["node", "worker.js"],
        args: [],
        volumeMounts: [],
      },
    ],
    suggestions: [
      {
        id: "oom-patch-memory",
        kind: "remediation",
        severity: "critical",
        title: "Increase the memory limit for the OOM-killed container",
        description: "The kernel terminated checkout-worker because it exceeded its 512Mi memory limit. A measured increase to 1Gi gives the process room while preserving a bound.",
        action: {
          type: "patchResources",
          kind: "Deployment",
          namespace: "broken-apps",
          name: "checkout-worker",
          container: "checkout-worker",
          resources: { limits: { memory: "1Gi", cpu: "1" }, requests: { memory: "512Mi", cpu: "500m" } },
        },
        risk: "medium",
        safe: true,
        evidence: ["Container checkout-worker was OOMKilled (exit code 137).", "Current memory limit: 512 MiB.", "6 restarts observed."],
      },
    ],
  },
  "broken-apps/inventory-sync-6f8c7d9b4-4vq2n": {
    conditions: [
      { type: "PodScheduled", status: "True", reason: "", message: "" },
      { type: "Initialized", status: "True", reason: "", message: "" },
      { type: "ContainersReady", status: "False", reason: "ContainersNotReady", message: "containers with unready status: [inventory-sync]" },
      { type: "Ready", status: "False", reason: "ContainersNotReady", message: "containers with unready status: [inventory-sync]" },
    ],
    containers: [
      {
        name: "inventory-sync",
        image: "registry.acme.io/inventory-sync:1.9.0",
        ready: false,
        restarts: 0,
        state: "waiting",
        reason: "ImagePullBackOff",
        lastReason: "",
        resources: { limits: { cpu: "300m", memory: "256Mi" }, requests: { cpu: "100m", memory: "128Mi" } },
        ports: [{ name: "http", containerPort: 9090, protocol: "TCP" }],
        env: [{ name: "INVENTORY_API", value: "https://inventory.internal" }],
        command: [],
        args: [],
        volumeMounts: [],
      },
    ],
    suggestions: [
      {
        id: "image-pull",
        kind: "diagnostic",
        severity: "critical",
        title: "The container image cannot be pulled",
        description: "The kubelet cannot authenticate to registry.acme.io. Check the imagePullSecret, the tag, and registry egress. If the tag is wrong, patch the workload with a known-good tag.",
        action: null,
        risk: "none",
        safe: true,
        evidence: ["Image: registry.acme.io/inventory-sync:1.9.0", "Failed: 401 Unauthorized"],
      },
    ],
  },
  "demo-issues/legacy-auth-0": {
    conditions: [
      { type: "PodScheduled", status: "False", reason: "Unschedulable", message: "0/3 nodes are available: 1 node(s) had untolerated taint {dedicated: auth}, 2 Insufficient memory." },
      { type: "Initialized", status: "False", reason: "", message: "" },
      { type: "Ready", status: "False", reason: "", message: "" },
    ],
    containers: [
      {
        name: "legacy-auth",
        image: "ghcr.io/acme/legacy-auth:0.9.7",
        ready: false,
        restarts: 0,
        state: "waiting",
        reason: "Unschedulable",
        lastReason: "",
        resources: { limits: { cpu: "2", memory: "4Gi" }, requests: { cpu: "2", memory: "4Gi" } },
        ports: [{ name: "https", containerPort: 8443, protocol: "TCP" }],
        env: [],
        command: [],
        args: [],
        volumeMounts: [],
      },
    ],
    suggestions: [
      {
        id: "pending",
        kind: "diagnostic",
        severity: "warning",
        title: "Pod is pending and has not been scheduled",
        description: "The scheduler cannot place this pod because no node has 4Gi allocatable memory and the only node with the auth taint is excluded. Reduce requests or add a toleration.",
        action: null,
        risk: "none",
        safe: true,
        evidence: ["0/3 nodes are available.", "1 node(s) had untolerated taint {dedicated: auth}.", "2 Insufficient memory."],
      },
    ],
  },
};

const logSets = {
  "broken-apps/payment-api-7d9c8f6b5-2xk4q/payment-api": [
    ["info", "booting payment-api 2.4.1 (node 20.11.1)"],
    ["info", "loading config from /etc/payment/config.yaml"],
    ["info", "connecting to postgres at payment-db.broken-apps.svc:5432"],
    ["error", "connection refused: postgres://payment-db.broken-apps.svc:5432"],
    ["info", "retrying database connection in 2s (attempt 1/5)"],
    ["error", "connection refused: postgres://payment-db.broken-apps.svc:5432"],
    ["info", "retrying database connection in 4s (attempt 2/5)"],
    ["error", "connection refused: postgres://payment-db.broken-apps.svc:5432"],
    ["info", "retrying database connection in 8s (attempt 3/5)"],
    ["error", "connection refused: postgres://payment-db.broken-apps.svc:5432"],
    ["error", "unhandled rejection: could not acquire migration lock"],
    ["error", "Error: connect ECONNREFUSED 10.43.22.11:5432"],
    ["error", "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1595:16)"],
    ["error", "    at processTicksAndRejections (node:internal/process/task_queues:95:5)"],
    ["warn", "graceful shutdown timed out after 10s; exiting"],
    ["error", "process exited with code 1"],
    ["info", "--- restart ---"],
    ["info", "booting payment-api 2.4.1 (node 20.11.1)"],
    ["info", "connecting to postgres at payment-db.broken-apps.svc:5432"],
    ["error", "connection refused: postgres://payment-db.broken-apps.svc:5432"],
    ["error", "Error: connect ECONNREFUSED 10.43.22.11:5432"],
    ["error", "process exited with code 1"],
  ],
  "broken-apps/checkout-worker-5b7d9c8f7d-9m2pl/checkout-worker": [
    ["info", "checkout-worker online; concurrency=8 queue=checkout"],
    ["info", "consumed 24 messages in 1.8s"],
    ["info", "consumed 31 messages in 2.1s"],
    ["warn", "heap usage 438MiB / 512MiB (85%)"],
    ["warn", "event loop lag 184ms; queue depth 1,204"],
    ["info", "consumed 47 messages in 3.4s"],
    ["warn", "heap usage 492MiB / 512MiB (96%)"],
    ["error", "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"],
    ["error", " 1: 0xb7c1a0 node::Abort() [node]"],
    ["error", " 2: 0xa8b2f0 node::FatalError(char const*, char const*) [node]"],
    ["error", " 3: 0xd9e2a0 v8::Utils::ReportOOMFailure(v8::internal::Isolate*, char const*, bool) [node]"],
    ["error", " 4: 0xd9e450 v8::internal::V8::FatalProcessOutOfMemory(v8::internal::Isolate*, char const*, bool) [node]"],
    ["warn", "Memory cgroup out of memory: Killed process 1 (node)"],
  ],
  "broken-apps/inventory-sync-6f8c7d9b4-4vq2n/inventory-sync": [
    ["info", "container waiting: ImagePullBackOff"],
    ["error", "failed to resolve reference \"registry.acme.io/inventory-sync:1.9.0\": 401 Unauthorized"],
    ["info", "back-off 10s pulling image"],
    ["error", "failed to resolve reference \"registry.acme.io/inventory-sync:1.9.0\": 401 Unauthorized"],
    ["info", "back-off 20s pulling image"],
  ],
  "demo-issues/frontend-6b8f9d7c5-2j4kl/frontend": [
    ["info", "ready - serving on 0.0.0.0:3000"],
    ["info", "GET / 200 12ms"],
    ["info", "GET /api/cart 200 34ms"],
    ["info", "GET /assets/app.7f3c.js 200 4ms"],
    ["info", "GET /api/products?limit=24 200 41ms"],
    ["info", "GET /healthz 200 1ms"],
    ["info", "GET /api/cart 200 29ms"],
    ["info", "GET / 200 9ms"],
  ],
};

const securityReports = [
  {
    name: "replicaset-old-nginx-6d8f7c9b5.old-nginx",
    namespace: "demo-vulns",
    kind: "ReplicaSet",
    workload: "old-nginx",
    container: "nginx",
    summary: { critical: 3, high: 8, medium: 12, low: 4, unknown: 0 },
    vulnerabilities: [
      { id: "CVE-2024-6387", package: "openssl", version: "1.1.1k", severity: "CRITICAL", title: "regreSSHion: remote unauthenticated code execution in OpenSSH", fixedVersion: "1.1.1w" },
      { id: "CVE-2023-44487", package: "nghttp2", version: "1.41.0", severity: "HIGH", title: "HTTP/2 Rapid Reset attack allows denial of service", fixedVersion: "1.57.0" },
      { id: "CVE-2024-24790", package: "libc", version: "2.31", severity: "HIGH", title: "net/netip: unexpected behavior in IPv4-mapped IPv6 addresses", fixedVersion: "2.39" },
    ],
  },
  {
    name: "statefulset-old-redis-0.old-redis",
    namespace: "demo-vulns",
    kind: "StatefulSet",
    workload: "old-redis",
    container: "redis",
    summary: { critical: 0, high: 5, medium: 6, low: 2, unknown: 0 },
    vulnerabilities: [
      { id: "CVE-2022-0543", package: "redis", version: "6.0.8", severity: "HIGH", title: "Lua sandbox escape via Debian package", fixedVersion: "6.0.17" },
      { id: "CVE-2023-45145", package: "redis", version: "6.0.8", severity: "MEDIUM", title: "Race condition in listening socket may lead to auth bypass", fixedVersion: "6.2.14" },
    ],
  },
  {
    name: "deployment-payment-api.payment-api",
    namespace: "broken-apps",
    kind: "Deployment",
    workload: "payment-api",
    container: "payment-api",
    summary: { critical: 0, high: 1, medium: 2, low: 3, unknown: 0 },
    vulnerabilities: [
      { id: "CVE-2024-27980", package: "node", version: "20.11.1", severity: "HIGH", title: "Node.js command injection via child_process.spawn with shell option", fixedVersion: "20.12.2" },
      { id: "CVE-2024-22019", package: "node", version: "20.11.1", severity: "MEDIUM", title: "HTTP request smuggling via chunked encoding", fixedVersion: "20.11.1" },
    ],
  },
  {
    name: "deployment-checkout-worker.checkout-worker",
    namespace: "broken-apps",
    kind: "Deployment",
    workload: "checkout-worker",
    container: "checkout-worker",
    summary: { critical: 0, high: 1, medium: 0, low: 1, unknown: 0 },
    vulnerabilities: [
      { id: "CVE-2024-28863", package: "tar", version: "6.1.13", severity: "HIGH", title: "tar parsing denial of service", fixedVersion: "6.2.1" },
    ],
  },
];

const audit = [
  { id: "aud-1", timestamp: isoAgo(38 * MINUTE), action: "Restart workload", target: "broken-apps/payment-api", status: "success", detail: "Rolling restart triggered after crash loop confirmation." },
  { id: "aud-2", timestamp: isoAgo(64 * MINUTE), action: "Patch resources", target: "broken-apps/checkout-worker", status: "success", detail: "Memory limit raised from 512Mi to 1Gi." },
  { id: "aud-3", timestamp: isoAgo(2 * HOUR), action: "Diagnose pod", target: "broken-apps/inventory-sync-6f8c7d9b4-4vq2n", status: "success", detail: "Ollama qwen2.5:7b diagnosis completed." },
  { id: "aud-4", timestamp: isoAgo(3 * HOUR), action: "Delete pod", target: "kube-system/coredns-7d8f9c6b5-4nq2x", status: "blocked", detail: "Blocked by protected namespace policy." },
  { id: "aud-5", timestamp: isoAgo(1 * DAY), action: "Connect cluster", target: "kestrel-demo", status: "success", detail: "Connected through https://127.0.0.1:6443." },
];

const settings = {
  kubeconfigPath: "C:\\Users\\demo\\.kube\\config",
  context: "kestrel-demo",
  activeProvider: "ollama",
  activeModel: "qwen2.5:7b",
  providers: [
    {
      kind: "ollama",
      label: "Ollama",
      enabled: true,
      baseUrl: "http://127.0.0.1:11434",
      apiKey: "",
      model: "qwen2.5:7b",
      models: ["qwen2.5:7b", "llama3.2:3b", "deepseek-r1:8b", "nomic-embed-text"],
      status: "ready",
      latencyMs: 42,
      hint: "Runs entirely on this machine. No key required.",
      docsUrl: "https://ollama.com",
      mode: "",
    },
    {
      kind: "gemini",
      label: "Gemini",
      enabled: false,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "",
      model: "gemini-2.5-flash",
      models: ["gemini-2.5-flash", "gemini-2.5-pro"],
      status: "unconfigured",
      latencyMs: 0,
      hint: "Get a key from Google AI Studio.",
      docsUrl: "https://aistudio.google.com/apikey",
      mode: "",
    },
    {
      kind: "openrouter",
      label: "OpenRouter",
      enabled: false,
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "",
      model: "openrouter/auto",
      models: ["openrouter/auto", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash", "openai/gpt-4.1"],
      status: "unconfigured",
      latencyMs: 0,
      hint: "One key for hundreds of models.",
      docsUrl: "https://openrouter.ai/keys",
      mode: "",
    },
    {
      kind: "anthropic",
      label: "Anthropic",
      enabled: false,
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "",
      model: "claude-sonnet-4-5",
      models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
      status: "unconfigured",
      latencyMs: 0,
      hint: "Direct Anthropic Messages API.",
      docsUrl: "https://console.anthropic.com/settings/keys",
      mode: "",
    },
    {
      kind: "githubCopilot",
      label: "GitHub Copilot",
      enabled: false,
      baseUrl: "https://api.githubcopilot.com",
      apiKey: "",
      model: "gpt-4o",
      models: ["gpt-4o", "gpt-4.1", "claude-sonnet-4", "o4-mini"],
      status: "unconfigured",
      latencyMs: 0,
      hint: "Uses a GitHub token. Falls back to GitHub Models if Copilot is unavailable.",
      docsUrl: "https://github.com/settings/tokens",
      mode: "auto",
    },
  ],
  safety: {
    protectedNamespaces: ["kube-system", "kube-public", "kube-node-lease"],
    requireConfirmation: true,
    maxOomPatchCount: 3,
    maxMemoryMi: 1024,
    allowDestructive: false,
    redactLogs: true,
  },
  appearance: {
    theme: "light",
    density: "comfortable",
    reduceMotion: false,
    showSeconds: false,
  },
  onboardingComplete: true,
  telemetry: false,
};

function findPod(namespace, name) {
  return pods.find((p) => p.namespace === namespace && p.name === name) || pods[0];
}

function podDetail(namespace, name) {
  const p = findPod(namespace, name);
  const override = detailOverrides[`${namespace}/${name}`] || {};
  return {
    pod: deepClone(p),
    owner: deepClone(p.owner),
    conditions: override.conditions || [
      { type: "PodScheduled", status: "True", reason: "", message: "" },
      { type: "Initialized", status: "True", reason: "", message: "" },
      { type: "ContainersReady", status: "True", reason: "", message: "" },
      { type: "Ready", status: "True", reason: "", message: "" },
    ],
    containers:
      override.containers ||
      p.containers.map((c) => ({
        name: c.name,
        image: c.image,
        ready: c.ready,
        restarts: c.restarts,
        state: c.state,
        reason: c.reason,
        lastReason: c.lastReason,
        startedAt: p.createdAt,
        finishedAt: null,
        exitCode: null,
        resources: {
          limits: { cpu: "500m", memory: "256Mi" },
          requests: { cpu: "100m", memory: "128Mi" },
        },
        ports: [],
        env: [],
        command: [],
        args: [],
        volumeMounts: [],
      })),
    serviceAccount: "default",
    restartPolicy: "Always",
    qosClass: "Burstable",
    priorityClass: "",
    podIp: "10.42.1.37",
    hostIp: "172.30.123.34",
    nodeName: p.node,
    suggestions: override.suggestions || [],
    events: events.filter((e) => e.involvedName === name || e.involvedName === p.owner?.name),
    labels: p.labels,
    annotations: {
      "kubectl.kubernetes.io/restartedAt": isoAgo(38 * MINUTE),
      "healer.k8s.io/oom-patch-count": name.includes("checkout") ? "1" : "0",
    },
  };
}

function logLines(namespace, name, container) {
  const key = `${namespace}/${name}/${container}`;
  const raw = logSets[key];
  const stamp = Date.now();
  if (!raw) {
    return [
      { timestamp: new Date(stamp - 6000).toISOString(), level: "info", text: `streaming logs for ${container || name}…` },
      { timestamp: new Date(stamp - 3000).toISOString(), level: "info", text: "no recent output; container is healthy" },
    ];
  }
  return raw.map(([level, text], i) => ({
    timestamp: new Date(stamp - (raw.length - i) * 2200).toISOString(),
    level,
    text,
  }));
}

function diagnosisFor(namespace, name) {
  const p = findPod(namespace, name);
  const base = {
    id: `diag-${Date.now()}`,
    target: "Pod",
    namespace,
    name,
    provider: settings.activeProvider,
    model: settings.activeModel,
    createdAt: new Date().toISOString(),
    usage: { inputTokens: 2840, outputTokens: 612 },
    raw: null,
  };
  if (name.includes("payment")) {
    return {
      ...base,
      summary: "payment-api is crash-looping because the database migration step races Postgres readiness.",
      severity: "critical",
      rootCause:
        "The container starts a schema migration before payment-db accepts connections. The migration client exits on ECONNREFUSED, the process terminates with code 1, and Kubernetes backs off. The readiness probe never succeeds because the HTTP server is started after migration.",
      confidence: 0.87,
      evidence: [
        "14 restarts, last exit code 1 (Error).",
        "Logs show repeated `connect ECONNREFUSED 10.43.22.11:5432`.",
        "Readiness probe fails with connection refused on :8080.",
        "The migration lock is acquired before the server binds the port.",
      ],
      recommendations: [
        {
          id: "rec-1",
          title: "Add a Postgres readiness gate to the migration initContainer",
          detail: "Run `pg_isready` in a loop or use an initContainer that waits for payment-db:5432. This prevents the migration from racing the database and is the durable fix.",
          risk: "low",
          action: null,
        },
        {
          id: "rec-2",
          title: "Restart after confirming the database is reachable",
          detail: "Once payment-db has endpoints, a rolling restart will clear the backoff and let the new pod attempt migration with a live database.",
          risk: "medium",
          action: { type: "restartWorkload", kind: "Deployment", namespace: "broken-apps", name: "payment-api" },
        },
      ],
      commands: [
        "kubectl -n broken-apps get endpoints payment-db",
        "kubectl -n broken-apps logs deploy/payment-api --previous --tail=200",
        "kubectl -n broken-apps rollout restart deploy/payment-api",
      ],
      prevention: [
        "Gate migrations on database readiness and make them idempotent.",
        "Alert on restart count > 3 for any deployment in broken-apps.",
      ],
    };
  }
  if (name.includes("checkout")) {
    return {
      ...base,
      summary: "checkout-worker is being OOM-killed under queue backpressure; the heap limit is below the working set.",
      severity: "critical",
      rootCause:
        "The worker's V8 heap grows to ~500MiB while draining a 1,200-message backlog. The container limit is 512Mi, so the kernel kills the process before V8 can complete garbage collection.",
      confidence: 0.91,
      evidence: [
        "OOMKilled with exit code 137, 6 restarts.",
        "Heap usage reached 96% of the 512Mi limit before termination.",
        "Queue depth climbed to 1,204 messages during the incident.",
      ],
      recommendations: [
        {
          id: "rec-1",
          title: "Raise the memory limit to 1Gi and requests to 512Mi",
          detail: "This matches the observed working set plus headroom. Keep the CPU limit unchanged; the bottleneck is memory, not CPU.",
          risk: "medium",
          action: {
            type: "patchResources",
            kind: "Deployment",
            namespace: "broken-apps",
            name: "checkout-worker",
            container: "checkout-worker",
            resources: { limits: { memory: "1Gi", cpu: "1" }, requests: { memory: "512Mi", cpu: "500m" } },
          },
        },
        {
          id: "rec-2",
          title: "Cap queue concurrency and add backpressure",
          detail: "Reduce WORKER_CONCURRENCY from 8 to 4 or add a bounded queue. This lowers peak heap and prevents a single burst from exhausting the container.",
          risk: "low",
          action: null,
        },
      ],
      commands: [
        "kubectl -n broken-apps top pod checkout-worker-5b7d9c8f7d-9m2pl",
        "kubectl -n broken-apps logs deploy/checkout-worker --previous --tail=120",
      ],
      prevention: [
        "Set a memory request equal to 50% of the limit so the scheduler reserves headroom.",
        "Add a heap-usage alert at 80% of the container limit.",
      ],
    };
  }
  if (name.includes("inventory")) {
    return {
      ...base,
      summary: "inventory-sync cannot pull its image because the registry rejects the kubelet's credentials.",
      severity: "critical",
      rootCause:
        "The imagePullSecret referenced by the pod is either missing or scoped to a different registry. The kubelet receives 401 Unauthorized from registry.acme.io and enters ImagePullBackOff.",
      confidence: 0.84,
      evidence: [
        "Failed to pull image registry.acme.io/inventory-sync:1.9.0: 401 Unauthorized.",
        "Pod is Pending with ImagePullBackOff; no container has started.",
      ],
      recommendations: [
        {
          id: "rec-1",
          title: "Verify and re-create the registry pull secret",
          detail: "Confirm the secret exists in broken-apps and contains a dockerconfigjson for registry.acme.io. Then restart the rollout.",
          risk: "low",
          action: null,
        },
      ],
      commands: [
        "kubectl -n broken-apps get secret regcred -o jsonpath='{.type}'",
        "kubectl -n broken-apps describe pod inventory-sync-6f8c7d9b4-4vq2n",
      ],
      prevention: ["Use a namespace-scoped imagePullSecret and rotate registry credentials before expiry."],
    };
  }
  if (name.includes("legacy-auth")) {
    return {
      ...base,
      summary: "legacy-auth is unschedulable because its 4Gi request exceeds allocatable memory on every eligible node.",
      severity: "warning",
      rootCause:
        "The StatefulSet requests 2 CPU and 4Gi memory with a strict node affinity/toleration combination. No node satisfies both the taint and the memory request.",
      confidence: 0.93,
      evidence: [
        "0/3 nodes available: 1 untolerated taint, 2 insufficient memory.",
        "Request equals limit at 4Gi; QoS is Guaranteed.",
      ],
      recommendations: [
        {
          id: "rec-1",
          title: "Lower the memory request to the observed working set",
          detail: "Start with 2Gi and measure. The current 4Gi request is larger than any node's free allocatable memory after system reservations.",
          risk: "medium",
          action: null,
        },
        {
          id: "rec-2",
          title: "Add the auth toleration only if the dedicated node is intended",
          detail: "If the workload is meant for the tainted auth node, add the matching toleration. Otherwise remove the node affinity.",
          risk: "low",
          action: null,
        },
      ],
      commands: [
        "kubectl -n demo-issues describe pod legacy-auth-0",
        "kubectl get nodes -o custom-columns=NAME:.metadata.name,CPU:.status.allocatable.cpu,MEM:.status.allocatable.memory",
      ],
      prevention: ["Set requests from measured p95 usage and add a capacity alert before requests exceed allocatable."],
    };
  }
  return {
    ...base,
    summary: `${p.name} is healthy; no deterministic failure signal was found.`,
    severity: "info",
    rootCause: "The pod is running and ready. No warning events or restart pressure were detected.",
    confidence: 0.76,
    evidence: [`Ready ${p.ready}`, `${p.restarts} restarts`, `Phase ${p.phase}`],
    recommendations: [
      { id: "rec-1", title: "No action required", detail: "Continue monitoring. Ask the Copilot to inspect trends or compare this pod with its peers.", risk: "none", action: null },
    ],
    commands: [`kubectl -n ${namespace} get pod ${p.name} -o wide`],
    prevention: ["Keep resource requests aligned with observed usage."],
  };
}

function chatReply(prompt, context) {
  const q = String(prompt || "").toLowerCase();
  const selected = context?.selectedPod;
  if (q.includes("payment") || q.includes("crash")) {
    return `**payment-api is crash-looping on database readiness, not on application code.**

The strongest signal is the sequence in the previous logs:

\`\`\`text
connect ECONNREFUSED 10.43.22.11:5432
unhandled rejection: could not acquire migration lock
process exited with code 1
\`\`\`

The migration runs before the HTTP server binds :8080, so the readiness probe also fails. Kubernetes backs off, and the cycle repeats.

**What I would do next**
1. Confirm \`payment-db\` has endpoints: \`kubectl -n broken-apps get endpoints payment-db\`.
2. Add a readiness gate (initContainer with \`pg_isready\`) so migration cannot race the database.
3. Only then restart the deployment. A restart alone will not fix the race.

Confidence: **87%**. The missing piece is whether payment-db was intentionally down during the deploy window.`;
  }
  if (q.includes("oom") || q.includes("checkout") || q.includes("memory")) {
    return `**checkout-worker is memory-bound, not CPU-bound.**

It was killed with exit code **137** after heap usage reached **96% of its 512Mi limit**. The queue depth of 1,204 explains the burst.

I would raise the limit to **1Gi** and the request to **512Mi**, then reduce \`WORKER_CONCURRENCY\` from 8 to 4 to lower peak heap. The first change stops the immediate crash; the second prevents the next burst from doing the same thing.

I can prepare the resource patch for approval. It will only touch \`broken-apps/checkout-worker\`.`;
  }
  if (q.includes("pending") || q.includes("schedule") || q.includes("legacy")) {
    return `**legacy-auth cannot be scheduled because its request is larger than any eligible node's free memory.**

The scheduler reports:

\`\`\`text
0/3 nodes are available: 1 node(s) had untolerated taint {dedicated: auth},
2 Insufficient memory.
\`\`\`

Its request is **4Gi**, and it uses a Guaranteed QoS shape (request = limit). Either lower the request to the measured working set (start at 2Gi) or add the matching toleration for the auth node. Do not do both blindly — they solve different constraints.`;
  }
  if (q.includes("inventory") || q.includes("image")) {
    return `**inventory-sync is blocked at the registry, not inside Kubernetes.**

The kubelet is getting **401 Unauthorized** from \`registry.acme.io\`. That usually means the \`imagePullSecret\` is missing in \`broken-apps\`, or it was created for a different registry host.

Check the secret type and the \`imagePullSecrets\` on the pod, then recreate the secret if needed. No amount of restarting will fix an auth failure.`;
  }
  if (selected) {
    return `I’m looking at **${selected.name}** in \`${selected.namespace}\`.

Current state: **${selected.status || selected.phase}**, ready **${selected.ready}**, **${selected.restarts}** restarts. The pod is owned by a **${selected.owner?.kind || "Pod"}** named \`${selected.owner?.name || selected.name}\`.

Ask me to diagnose it, compare it with peers, or prepare a remediation. I will keep every mutation behind an approval step.`;
  }
  return `I’m connected to **shinjiru**, a k3s cluster with **3 nodes** and **16 pods**. Three workloads need attention: payment-api (CrashLoopBackOff), checkout-worker (OOMKilled), and inventory-sync (ImagePullBackOff).

You can ask me to:
- Diagnose a specific pod or deployment.
- Explain a warning event in plain language.
- Compare resource requests with live usage.
- Prepare a restart, image patch, or resource patch for approval.

Nothing is mutated without a confirmation step.`;
}

let mockState = {
  connected: false,
  snapshot: deepClone(snapshot),
  settings: deepClone(settings),
  audit: deepClone(audit),
};

function tick() {
  const s = mockState.snapshot;
  s.generatedAt = new Date().toISOString();
  s.cluster.latencyMs = Math.max(12, Math.round(22 + Math.random() * 12));
  for (const n of s.nodes) {
    n.cpuUsage = Math.max(0.15, Math.min(n.cpuCores * 0.92, n.cpuUsage + (Math.random() - 0.5) * 0.08));
    n.memoryUsage = Math.max(0.2 * 1024 ** 3, Math.min(n.memoryBytes * 0.94, n.memoryUsage + (Math.random() - 0.5) * 24 * 1024 ** 2));
  }
  for (const p of s.pods) {
    if (p.cpuUsage > 0) p.cpuUsage = Math.max(0.001, p.cpuUsage + (Math.random() - 0.5) * 0.004);
    if (p.memoryUsage > 0) p.memoryUsage = Math.max(4 * 1024 ** 2, p.memoryUsage + (Math.random() - 0.5) * 2 * 1024 ** 2);
  }
  const last = s.history[s.history.length - 1];
  s.history = [
    ...s.history.slice(-35),
    {
      t: Date.now(),
      cpu: Math.max(0.1, Math.min(0.95, (last?.cpu || 0.45) + (Math.random() - 0.5) * 0.05)),
      memory: Math.max(0.1, Math.min(0.95, (last?.memory || 0.5) + (Math.random() - 0.5) * 0.035)),
    },
  ];
  return deepClone(s);
}

export const mock = {
  isMock: true,

  async bootstrap() {
    return {
      settings: deepClone(mockState.settings),
      audit: deepClone(mockState.audit),
      appVersion: "0.1.1",
      platform: "browser",
      isTauri: false,
    };
  },

  async connect() {
    await new Promise((r) => setTimeout(r, 650));
    mockState.connected = true;
    return tick();
  },

  async snapshot() {
    if (!mockState.connected) throw new Error("not connected");
    return tick();
  },

  async podDetail(namespace, name) {
    await new Promise((r) => setTimeout(r, 180));
    return deepClone(podDetail(namespace, name));
  },

  async logs(namespace, name, container, tail = 200, previous = false) {
    await new Promise((r) => setTimeout(r, 260));
    const lines = logLines(namespace, name, container);
    return {
      container: container || "",
      previous,
      lines: lines.slice(-tail),
      truncated: lines.length >= tail,
      error: null,
    };
  },

  async securityReports() {
    await new Promise((r) => setTimeout(r, 220));
    return deepClone(securityReports);
  },

  async diagnose(namespace, name) {
    await new Promise((r) => setTimeout(r, 1200));
    return deepClone(diagnosisFor(namespace, name));
  },

  async chat(messages, context, onDelta) {
    const last = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const full = chatReply(last, context);
    const chunks = full.match(/.{1,6}/gs) || [full];
    let content = "";
    for (const chunk of chunks) {
      content += chunk;
      onDelta?.(chunk);
      await new Promise((r) => setTimeout(r, 14));
    }
    return {
      content,
      usage: { inputTokens: 1840, outputTokens: Math.round(content.length / 4) },
      model: mockState.settings.activeModel || "qwen2.5:7b",
    };
  },

  async runAction(action) {
    await new Promise((r) => setTimeout(r, 900));
    const target = `${action.namespace}/${action.name}`;
    const message =
      action.type === "restartWorkload"
        ? `Rolling restart requested for ${action.kind} ${target}.`
        : action.type === "patchResources"
          ? `Resources updated for ${target}/${action.container}.`
          : action.type === "patchImage"
            ? `Image for ${action.container} set to ${action.image}.`
            : action.type === "deletePod"
              ? `Pod ${target} deleted.`
              : `Action ${action.type} applied to ${target}.`;
    mockState.audit = [
      {
        id: `aud-${Date.now()}`,
        timestamp: new Date().toISOString(),
        action: action.type,
        target,
        status: "success",
        detail: message,
      },
      ...mockState.audit,
    ];
    return { message, audit: deepClone(mockState.audit) };
  },

  async saveSettings(next) {
    mockState.settings = deepClone(next);
    return deepClone(mockState.settings);
  },

  async testProvider(kind) {
    await new Promise((r) => setTimeout(r, 900));
    const provider = mockState.settings.providers.find((p) => p.kind === kind);
    if (!provider) throw new Error("provider not found");
    if (kind === "gemini" || kind === "openrouter" || kind === "anthropic" || kind === "githubCopilot") {
      if (!provider.apiKey) {
        throw new Error(`${provider.label} needs an API key. Add one and try again.`);
      }
    }
    const models =
      provider.models?.length
        ? provider.models
        : kind === "ollama"
          ? ["qwen2.5:7b", "llama3.2:3b"]
          : ["default"];
    return { models, latencyMs: 18 + Math.round(Math.random() * 60), status: "ready" };
  },

  async listModels(kind) {
    await new Promise((r) => setTimeout(r, 400));
    const provider = mockState.settings.providers.find((p) => p.kind === kind);
    return provider?.models || [];
  },

  async audit() {
    return deepClone(mockState.audit);
  },

  async checkForUpdates() {
    return null;
  },

  subscribe(cb) {
    const t = setInterval(() => {
      if (mockState.connected) cb(tick());
    }, 6000);
    return () => clearInterval(t);
  },
};
