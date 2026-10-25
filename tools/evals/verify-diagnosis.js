(async () => {
  const results = {};
  for (const kind of ["gemini", "openrouter", "anthropic", "githubCopilot"]) {
    const boot = await window.__TAURI__.core.invoke("get_bootstrap");
    const settings = boot.settings;
    const provider = settings.providers.find((p) => p.kind === kind);
    settings.activeProvider = kind;
    settings.activeModel = provider?.model || "";
    await window.__TAURI__.core.invoke("save_settings", { settings });
    try {
      const d = await window.__TAURI__.core.invoke("diagnose_pod", {
        namespace: "broken-apps",
        name: "crashing-pod",
        container: null,
      });
      results[kind] = {
        ok: true,
        provider: d.provider,
        model: d.model,
        severity: d.severity,
        confidence: d.confidence,
        summary: d.summary,
        rootCause: d.rootCause,
        evidence: d.evidence,
        recommendations: d.recommendations?.map((r) => r.title) || [],
        commands: d.commands,
      };
    } catch (error) {
      results[kind] = { ok: false, error: String(error) };
    }
  }
  return JSON.stringify(results);
})()
