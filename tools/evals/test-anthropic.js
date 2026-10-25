(async () => {
  try {
    const result = await window.__TAURI__.core.invoke("test_provider", { kind: "anthropic" });
    return JSON.stringify({ ok: true, status: result.status, latencyMs: result.latencyMs, count: result.models?.length, models: result.models?.slice(0, 8) });
  } catch (error) {
    return JSON.stringify({ ok: false, error: String(error?.message || error) });
  }
})()
