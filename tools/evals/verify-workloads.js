(async () => {
  location.hash = "#/workloads";
  await new Promise((r) => setTimeout(r, 1600));
  const counts = [...document.querySelectorAll(".segmented [data-action='workloads-kind']")].map((b) => b.innerText.trim());
  const deploy = [...document.querySelectorAll("[data-action='workloads-kind']")].find((b) => b.dataset.kind === "Deployment");
  deploy?.click();
  await new Promise((r) => setTimeout(r, 800));
  const rows = [...document.querySelectorAll(".data-table tbody tr")];
  return JSON.stringify({
    counts,
    active: document.querySelector(".segmented .is-active")?.innerText.trim() || "",
    rowCount: rows.length,
    firstRow: rows[0]?.innerText?.replace(/\s+/g, " ").slice(0, 200) || "",
    header: document.querySelector(".data-table thead")?.innerText?.replace(/\s+/g, " ") || "",
    empty: document.querySelector(".table-empty")?.innerText || "",
  });
})()
