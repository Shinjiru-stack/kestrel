(async () => {
  const boot = await window.__TAURI__.core.invoke("get_bootstrap");
  return JSON.stringify({
    activeProvider: boot.settings.activeProvider,
    activeModel: boot.settings.activeModel,
    providers: boot.settings.providers.map((p) => ({
      kind: p.kind,
      enabled: p.enabled,
      baseUrl: p.baseUrl,
      model: p.model,
      mode: p.mode,
      status: p.status,
      hasKey: Boolean(p.apiKey),
    })),
  });
})()
