(async () => {
  document.querySelector('[data-action="theme"]')?.click();
  await new Promise((r) => setTimeout(r, 700));
  return JSON.stringify({
    theme: document.documentElement.dataset.theme,
    label: document.getElementById("theme-label")?.innerText || "",
  });
})()
