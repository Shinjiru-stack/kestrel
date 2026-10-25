(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById("theme-label")?.closest("button")?.click();
  await sleep(600);
  const win = window.__TAURI__.window.getCurrentWindow();
  const before = await win.isMaximized();
  document.querySelector('[data-window="maximize"]')?.click();
  await sleep(1400);
  const after = await win.isMaximized();
  return JSON.stringify({
    theme: document.documentElement.dataset.theme,
    before,
    after,
    inner: { w: innerWidth, h: innerHeight },
    screen: { w: screen.width, h: screen.height },
    titlebar: document.querySelector(".titlebar")?.getBoundingClientRect().toJSON() || null,
  });
})()
