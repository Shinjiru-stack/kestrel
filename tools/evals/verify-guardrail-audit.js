(async () => {
  const out = {};
  try {
    await window.__TAURI__.core.invoke("run_action", {
      action: {
        type: "restartWorkload",
        kind: "Deployment",
        namespace: "kube-system",
        name: "coredns",
      },
    });
    out.guardrail = { blocked: false };
  } catch (error) {
    out.guardrail = { blocked: true, error: String(error) };
  }
  const boot = await window.__TAURI__.core.invoke("get_bootstrap");
  out.audit = boot.audit.slice(0, 5).map((e) => ({
    action: e.action,
    target: e.target,
    status: e.status,
    detail: e.detail,
    at: e.at,
  }));
  return JSON.stringify(out);
})()
