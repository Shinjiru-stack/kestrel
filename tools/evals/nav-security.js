(async () => {
  location.hash = "#/security";
  await new Promise((r) => setTimeout(r, 3500));
  return JSON.stringify({
    route: location.hash,
    head: document.querySelector(".page-head h1")?.innerText || "",
    loading: Boolean(document.querySelector(".skeleton, .loading")),
    text: document.querySelector(".view")?.innerText?.slice(0, 700) || "",
  });
})()
