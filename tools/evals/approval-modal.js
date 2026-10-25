(async () => {
  const row = [...document.querySelectorAll('tr[data-action="open-pod"]')].find((r) =>
    (r.dataset.name || "").includes("payment-api")
  );
  row?.click();
  await new Promise((r) => setTimeout(r, 600));
  document.querySelector('[data-action="drawer-tab"][data-tab="ai"]')?.click();
  await new Promise((r) => setTimeout(r, 250));
  document.querySelector('[data-action="drawer-diagnose"]')?.click();
  await new Promise((r) => setTimeout(r, 2200));
  document.querySelector('[data-action="diagnosis-apply"]')?.click();
  await new Promise((r) => setTimeout(r, 700));
  const modal = document.getElementById("modal");
  return JSON.stringify({
    modalHidden: modal?.hidden,
    modalText: (document.getElementById("modal-content")?.innerText || "").slice(0, 500),
  });
})()
