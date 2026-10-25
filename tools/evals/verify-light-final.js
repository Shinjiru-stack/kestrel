(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('[data-action="palette-close"]')?.click();
  await sleep(350);
  const themeButton = document.getElementById("theme-label")?.closest("button");
  themeButton?.click();
  await sleep(600);
  return JSON.stringify({
    theme: document.documentElement.dataset.theme,
    label: document.getElementById("theme-label")?.textContent || "",
    bodyBg: getComputedStyle(document.body).backgroundColor,
    panelBg: getComputedStyle(document.querySelector(".panel") || document.body).backgroundColor,
    stored: localStorage.getItem("kh-theme"),
    themeButtonFound: Boolean(themeButton),
  });
})()
