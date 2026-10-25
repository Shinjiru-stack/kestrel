(async () => {
  if (document.documentElement.dataset.theme === "light") {
    document.querySelector('[data-action="theme"]')?.click();
    await new Promise((r) => setTimeout(r, 700));
  }
  return JSON.stringify({
    theme: document.documentElement.dataset.theme,
    route: location.hash,
    connected: document.querySelector(".titlebar__status")?.innerText || "",
  });
})()
