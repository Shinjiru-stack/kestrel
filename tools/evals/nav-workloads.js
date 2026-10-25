(async () => {
  location.hash = "#/workloads";
  await new Promise((r) => setTimeout(r, 1800));
  return JSON.stringify({
    route: location.hash,
    head: document.querySelector(".page-head h1")?.innerText || "",
    rows: document.querySelectorAll(".data-table tbody tr").length,
    text: document.querySelector(".view")?.innerText?.slice(0, 300) || "",
  });
})()
