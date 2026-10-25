(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let drawer = document.querySelector(".drawer__panel");
  if (!drawer) {
    location.hash = "#/workloads";
    await sleep(1800);
    document.querySelector('tr[data-action="open-pod"]')?.click();
    await sleep(1400);
    drawer = document.querySelector(".drawer__panel");
  }
  if (!drawer) return JSON.stringify({ error: "drawer not open" });
  const btn = document.createElement("button");
  btn.dataset.action = "open-url";
  btn.dataset.url = "javascript:blocked";
  btn.id = "toast-test";
  drawer.appendChild(btn);
  btn.click();
  await sleep(500);
  const toast = document.querySelector(".toast");
  const toasts = document.querySelector(".toasts");
  const rect = (el) => el ? el.getBoundingClientRect().toJSON() : null;
  const result = {
    toastText: toast?.innerText?.replace(/\s+/g, " ").trim() || "",
    toastRect: rect(toast),
    drawerRect: rect(drawer),
    viewport: { w: innerWidth, h: innerHeight },
    toastRight: toasts ? getComputedStyle(toasts).right : "",
    toastWidth: toasts ? getComputedStyle(toasts).width : "",
    overlapsDrawer: Boolean(toast && drawer && toast.getBoundingClientRect().right > drawer.getBoundingClientRect().left),
  };
  btn.remove();
  return JSON.stringify(result);
})()
