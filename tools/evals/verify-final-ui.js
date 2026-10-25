(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('[data-action="drawer-close"]')?.click();
  await sleep(400);
  location.hash = "#/security";
  await sleep(2800);
  const initial = {
    selected: document.querySelector(".report-row.is-selected")?.innerText.replace(/\s+/g, " ").trim().slice(0, 160) || "",
    ariaCurrent: document.querySelector(".report-row[aria-current]")?.getAttribute("aria-current") || "",
    detail: document.querySelector(".vuln-detail__name")?.innerText.trim() || "",
    rows: document.querySelectorAll(".report-row").length,
  };
  document.querySelector('[data-action="security-filter"][data-filter="critical"]')?.click();
  await sleep(700);
  const filtered = {
    selected: document.querySelector(".report-row.is-selected")?.innerText.replace(/\s+/g, " ").trim().slice(0, 160) || "",
    ariaCurrent: document.querySelector(".report-row[aria-current]")?.getAttribute("aria-current") || "",
    detail: document.querySelector(".vuln-detail__name")?.innerText.trim() || "",
    rows: document.querySelectorAll(".report-row").length,
    filterActive: document.querySelector('[data-action="security-filter"].is-active')?.dataset.filter || "",
  };
  location.hash = "#/settings";
  await sleep(1000);
  document.querySelector('[data-action="settings-tab"][data-tab="audit"]')?.click();
  await sleep(700);
  const audit = {
    action: document.querySelector(".audit-table tbody tr td:nth-child(2)")?.innerText.trim() || "",
    foot: document.querySelector(".settings-section .panel__foot span")?.innerText.trim() || "",
    rows: document.querySelectorAll(".audit-table tbody tr").length,
  };
  return JSON.stringify({ initial, filtered, audit });
})()
