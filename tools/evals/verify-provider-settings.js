(async () => {
  location.hash = "#/settings";
  await new Promise((r) => setTimeout(r, 1200));
  document.querySelector('[data-action="settings-tab"][data-tab="providers"]')?.click();
  await new Promise((r) => setTimeout(r, 800));
  const gh = [...document.querySelectorAll('[data-action="provider-expand"]')].find((el) => el.dataset.kind === "githubCopilot");
  gh?.click();
  await new Promise((r) => setTimeout(r, 600));
  const cards = [...document.querySelectorAll(".provider-card")].map((card) => ({
    name: card.querySelector(".provider-card__name")?.innerText.trim() || "",
    sub: card.querySelector(".provider-card__sub")?.innerText.trim() || "",
    expanded: card.querySelector(".provider-card__body") !== null,
    mode: card.querySelector('[data-provider-field="mode"]')?.value || "",
    enabled: card.querySelector('[data-action="provider-toggle"]')?.getAttribute("aria-checked") || "",
    fields: [...card.querySelectorAll("[data-provider-field]")].map((el) => el.dataset.providerField),
  }));
  return JSON.stringify({ cards, active: document.querySelector(".connection-banner__title")?.innerText || "" });
})()
