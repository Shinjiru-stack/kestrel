(async () => {
  location.hash = "#/settings";
  await new Promise((r) => setTimeout(r, 1800));
  return JSON.stringify({
    route: location.hash,
    head: document.querySelector(".page-head h1")?.innerText || "",
    tabs: [...document.querySelectorAll("[data-settings-tab]")].map((t) => t.innerText.trim()),
    text: document.querySelector(".view")?.innerText?.slice(0, 500) || "",
  });
})()
