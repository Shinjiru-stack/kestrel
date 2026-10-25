(async () => {
  const row = [...document.querySelectorAll('tr[data-action="open-pod"]')].find((r) =>
    (r.dataset.name || "").includes("payment-api")
  );
  row?.click();
  await new Promise((r) => setTimeout(r, 700));
  document.querySelector('[data-action="drawer-tab"][data-tab="logs"]')?.click();
  await new Promise((r) => setTimeout(r, 1200));
  return document.querySelector("#drawer-content")?.innerText.slice(0, 200);
})()
