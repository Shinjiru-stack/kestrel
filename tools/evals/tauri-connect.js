(async () => {
  try {
    const snapshot = await window.__TAURI__.core.invoke("connect_cluster", {
      kubeconfigPath: "",
      context: "",
    });
    return JSON.stringify({
      ok: true,
      cluster: snapshot.cluster,
      pods: snapshot.pods?.length,
      nodes: snapshot.nodes?.length,
      workloads: snapshot.workloads?.length,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, error: String(error?.message || error) });
  }
})()
