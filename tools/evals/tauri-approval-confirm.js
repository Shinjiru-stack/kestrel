(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const confirm = document.querySelector('[data-action="modal-confirm"]');
  if (!confirm) return JSON.stringify({ ok: false, error: "no confirm button" });
  confirm.click();
  await sleep(6000);
  const audit = await window.__TAURI__.core.invoke("get_audit");
  const snapshot = await window.__TAURI__.core.invoke("refresh_snapshot");
  const pods = snapshot.pods
    .filter((pod) => pod.namespace === "demo-issues" && pod.name.startsWith("bad-liveness-app"))
    .map((pod) => ({ name: pod.name, status: pod.status, restarts: pod.restarts, age: pod.age }));
  return JSON.stringify({
    ok: true,
    modalHidden: document.getElementById("modal")?.hidden,
    toasts: [...document.querySelectorAll(".toast")].map((t) => t.innerText.slice(0, 220)),
    auditTop: audit.slice(0, 2),
    pods,
  });
})()
