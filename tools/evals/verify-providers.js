(async () => {
  const results = {};
  const kinds = ["gemini", "openrouter", "anthropic", "githubCopilot"];
  for (const kind of kinds) {
    results[kind] = {};
    try {
      const test = await window.__TAURI__.core.invoke("test_provider", { kind });
      results[kind].test = {
        ok: true,
        models: test.models,
        latencyMs: test.latencyMs,
        status: test.status,
      };
    } catch (error) {
      results[kind].test = { ok: false, error: String(error) };
    }

    const boot = await window.__TAURI__.core.invoke("get_bootstrap");
    const settings = boot.settings;
    const provider = settings.providers.find((p) => p.kind === kind);
    settings.activeProvider = kind;
    settings.activeModel = provider?.model || "";
    await window.__TAURI__.core.invoke("save_settings", { settings });

    const requestId = `mock-${kind}-${Date.now()}`;
    const deltas = [];
    const unlisten = await window.__TAURI__.event.listen("ai://delta", (event) => {
      if (event.payload?.requestId === requestId) deltas.push(event.payload.delta || "");
    });
    try {
      const response = await window.__TAURI__.core.invoke("chat", {
        requestId,
        messages: [{ role: "user", content: "Reply with the mock token." }],
        context: null,
      });
      results[kind].chat = {
        ok: true,
        content: response.content,
        model: response.model,
        usage: response.usage,
        deltaCount: deltas.length,
        streamed: deltas.join(""),
      };
    } catch (error) {
      results[kind].chat = { ok: false, error: String(error) };
    }
    if (typeof unlisten === "function") unlisten();
  }
  return JSON.stringify(results);
})()
