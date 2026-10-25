(async () => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise((r) => setTimeout(r, 700));
  return JSON.stringify({
    theme: document.documentElement.dataset.theme,
    paletteOpen: document.querySelector(".palette")?.getAttribute("aria-hidden") !== "true",
  });
})()
