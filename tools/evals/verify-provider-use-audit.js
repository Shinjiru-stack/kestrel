(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const expand = (kind) => [...document.querySelectorAll('[data-action="provider-expand"]')].find((el) => el.dataset.kind === kind)?.click();
  location.hash = "#/settings";
  await sleep(1200);
  document.querySelector('[data-action="settings-tab"][data-tab="providers"]')?.click();
  await sleep(700);

  const before = (await window.__TAURI__.core.invoke("get_bootstrap")).settings.activeProvider;
  expand("gemini");
  await sleep(500);
  const geminiUse = document.querySelector('[data-action="provider-use"][data-kind="gemini"]');
  geminiUse?.click();
  await sleep(1400);
  const afterGemini = (await window.__TAURI__.core.invoke("get_bootstrap")).settings.activeProvider;

  expand("ollama");
  await sleep(500);
  const ollamaUse = document.querySelector('[data-action="provider-use"][data-kind="ollama"]');
  ollamaUse?.click();
  await sleep(1400);
  const afterOllama = (await window.__TAURI__.core.invoke("get_bootstrap")).settings.activeProvider;

  document.querySelector('[data-action="settings-tab"][data-tab="audit"]')?.click();
  await sleep(900);
  const auditRows = [...document.querySelectorAll(".audit-table tbody tr")].slice(0, 5).map((el) => el.innerText.replace(/\s+/g, " ").trim().slice(0, 220));
  return JSON.stringify({ before, geminiUseFound: Boolean(geminiUse), afterGemini, ollamaUseFound: Boolean(ollamaUse), afterOllama, auditRows });
})()
