(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  location.hash = "#/overview";
  await sleep(700);
  const row = document.querySelector('[data-action="open-pod"]');
  if (!row) return JSON.stringify({ ok: false, error: "no attention pod row" });
  const pod = { namespace: row.dataset.namespace, name: row.dataset.name };
  row.click();
  await sleep(900);
  document.querySelector('[data-action="drawer-tab"][data-tab="ai"]')?.click();
  await sleep(350);
  const button = document.querySelector('[data-action="drawer-diagnose"]');
  if (!button) return JSON.stringify({ ok: false, error: "no diagnose button", pod });
  button.click();
  for (let i = 0; i < 180; i += 1) {
    await sleep(1000);
    const error = document.querySelector(".drawer__diagnosis-error, .diagnosis-error, .empty--error");
    if (error && error.innerText.trim()) {
      return JSON.stringify({ ok: false, pod, error: error.innerText.trim().slice(0, 800) });
    }
    const diagnosis = document.querySelector(".diagnosis");
    if (diagnosis) {
      const text = diagnosis.innerText;
      return JSON.stringify({
        ok: true,
        pod,
        summary: text.slice(0, 700),
        confidence: document.querySelector(".diagnosis__confidence")?.innerText || "",
        severity: document.querySelector(".diagnosis__head .badge")?.innerText || "",
        recommendations: [...document.querySelectorAll(".diagnosis__rec")].map((el) => el.innerText.slice(0, 180)),
      });
    }
  }
  return JSON.stringify({ ok: false, pod, error: "diagnosis timeout after 180s" });
})()
