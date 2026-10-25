(async () => {
  const snap = await window.__TAURI__.core.invoke("refresh_snapshot");
  const pods = (snap.pods || [])
    .filter((p) => p.cpuUsage != null || p.memoryUsage != null)
    .sort((a, b) => (b.cpuUsage || 0) - (a.cpuUsage || 0))
    .slice(0, 8)
    .map((p) => ({
      name: p.name,
      namespace: p.namespace,
      cpu: p.cpuUsage,
      mem: p.memoryUsage,
    }));
  return JSON.stringify({
    metricsAvailable: snap.metricsAvailable,
    nodes: (snap.nodes || []).map((n) => ({ name: n.name, cpu: n.cpuUsage, mem: n.memoryUsage, cores: n.cpuCores, bytes: n.memoryBytes })),
    pods,
    podCount: snap.pods.length,
  });
})()
