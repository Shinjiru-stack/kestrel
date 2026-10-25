(async () => {
  const boot = await window.__TAURI__.core.invoke("get_bootstrap");
  const settings = boot.settings;
  const byKind = Object.fromEntries(settings.providers.map((p) => [p.kind, p]));
  const apply = (kind, patch) => {
    const p = byKind[kind];
    if (!p) throw new Error(`missing provider ${kind}`);
    Object.assign(p, patch, { enabled: true, status: "unconfigured", latencyMs: 0, models: [] });
  };
  apply("gemini", {
    baseUrl: "http://127.0.0.1:18999/gemini",
    apiKey: "mock-gemini-key",
    model: "mock-gemini",
  });
  apply("openrouter", {
    baseUrl: "http://127.0.0.1:18999/openrouter",
    apiKey: "mock-openrouter-key",
    model: "mock-openrouter",
  });
  apply("anthropic", {
    baseUrl: "http://127.0.0.1:18999/anthropic",
    apiKey: "mock-anthropic-key",
    model: "mock-claude",
  });
  apply("githubCopilot", {
    baseUrl: "http://127.0.0.1:18999/github",
    apiKey: "mock-github-token",
    model: "mock-copilot",
    mode: "models",
  });
  settings.activeProvider = "openrouter";
  settings.activeModel = "mock-openrouter";
  await window.__TAURI__.core.invoke("save_settings", { settings });
  return JSON.stringify(
    settings.providers.map((p) => ({
      kind: p.kind,
      enabled: p.enabled,
      baseUrl: p.baseUrl,
      model: p.model,
      mode: p.mode,
      hasKey: Boolean(p.apiKey),
    }))
  );
})()
