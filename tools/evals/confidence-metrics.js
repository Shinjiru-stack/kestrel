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
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      cls: el.className,
      w: Math.round(r.width),
      h: Math.round(r.height),
      left: Math.round(r.left),
      bg: cs.backgroundImage !== "none" ? cs.backgroundImage.slice(0, 90) : cs.backgroundColor,
      display: cs.display,
      position: cs.position,
      text: (el.textContent || "").trim().slice(0, 40),
    };
  };
  const conf = document.querySelector(".diagnosis__confidence");
  return JSON.stringify({
    head: box(document.querySelector(".diagnosis__head")),
    conf: box(conf),
    i: box(conf?.querySelector("i")),
    span: box(conf?.querySelector("span")),
    inlineWidth: conf?.querySelector("i")?.getAttribute("style"),
  });
})()
