(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  location.hash = "#/overview";
  await sleep(1600);
  document.querySelector('.command-trigger')?.click();
  await sleep(700);
  const panel = document.querySelector('.palette__panel');
  return JSON.stringify({
    open: Boolean(panel && !document.getElementById('palette').hidden),
    panelRect: panel?.getBoundingClientRect().toJSON() || null,
    results: [...document.querySelectorAll('.palette__item')].slice(0, 6).map((el) => el.innerText.replace(/\s+/g, " ").trim().slice(0, 120)),
    groups: [...document.querySelectorAll('.palette__group')].map((el) => el.innerText.trim()),
    focused: document.activeElement?.id || "",
  });
})()
