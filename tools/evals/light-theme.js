(async () => {
  document.querySelector('[data-action="theme"]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  return document.documentElement.dataset.theme;
})()
