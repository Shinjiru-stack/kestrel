(async () => {
  location.hash = "#/nodes";
  await new Promise((r) => setTimeout(r, 1500));
  const rows = [...document.querySelectorAll(".capacity-row")].map((r) => r.innerText.replace(/\s+/g, " ").trim());
  return JSON.stringify({ rows, head: document.querySelector(".page-head h1")?.innerText || "" });
})()
