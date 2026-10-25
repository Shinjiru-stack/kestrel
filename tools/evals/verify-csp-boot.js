(async () => {
  await new Promise((r) => setTimeout(r, 1200));
  return JSON.stringify({
    booted: Boolean(document.getElementById("shell") && !document.getElementById("shell").hidden),
    view: document.getElementById("view")?.innerText?.replace(/\s+/g, " ").trim().slice(0, 180) || "",
    theme: document.documentElement.dataset.theme || "",
    tauri: Boolean(window.__TAURI__),
    scripts: [...document.scripts].map((s) => s.src || "inline"),
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || "",
  });
})()
