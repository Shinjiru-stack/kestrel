(async () => {
  const boot = await window.__TAURI__.core.invoke("get_bootstrap");
  const settings = boot.settings;
  const ollama = settings.providers.find((p) => p.kind === "ollama");
  if (ollama) {
    ollama.enabled = true;
    ollama.model = "llama3.1:latest";
    ollama.status = "ready";
  }
  settings.activeProvider = "ollama";
  settings.activeModel = "llama3.1:latest";
  await window.__TAURI__.core.invoke("save_settings", { settings });
  return JSON.stringify({ activeProvider: settings.activeProvider, activeModel: settings.activeModel });
})()
