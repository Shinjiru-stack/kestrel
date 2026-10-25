(async () => {
  const retry = document.querySelector('[data-action="retry-connect"]');
  if (retry) retry.click();
  else await window.__TAURI__.core.invoke("connect_cluster", { kubeconfigPath: null, context: null });
  await new Promise((r) => setTimeout(r, 5000));
  return JSON.stringify({
    route: location.hash,
    booted: document.body.classList.contains("is-booted"),
    viewText: document.querySelector(".view")?.innerText?.slice(0, 320) || "",
    connected: !document.querySelector(".disconnected"),
  });
})()
