(async () => {
  location.hash = "#/nodes";
  await new Promise((r) => setTimeout(r, 1800));
  return JSON.stringify({
    route: location.hash,
    head: document.querySelector(".page-head h1")?.innerText || "",
    text: document.querySelector(".view")?.innerText?.slice(0, 500) || "",
  });
})()
