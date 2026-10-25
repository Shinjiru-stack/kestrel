(async () => {
  location.hash = "#/security";
  await new Promise((r) => setTimeout(r, 3500));
  const selected = document.querySelector(".report-row[style*='mint-softer']") || document.querySelector(".report-row");
  return JSON.stringify({
    selected: selected?.innerText?.replace(/\s+/g, " ").trim().slice(0, 220) || "",
    detail: document.querySelector(".vuln-detail")?.innerText?.replace(/\s+/g, " ").trim().slice(0, 500) || "",
    firstRows: [...document.querySelectorAll(".report-row")].slice(0, 3).map((r) => r.innerText.replace(/\s+/g, " ").trim().slice(0, 180)),
  });
})()
