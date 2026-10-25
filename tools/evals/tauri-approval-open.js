(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const button = document.querySelector('[data-action="diagnosis-apply"][data-rec-index="1"]');
  if (!button) return JSON.stringify({ ok: false, error: "no apply button" });
  button.click();
  await sleep(600);
  const modal = document.getElementById("modal");
  return JSON.stringify({
    ok: true,
    hidden: modal?.hidden,
    text: (document.getElementById("modal-content")?.innerText || "").slice(0, 900),
    confirm: Boolean(document.querySelector('[data-action="modal-confirm"]')),
  });
})()
