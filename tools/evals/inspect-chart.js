(() => {
  const chart = document.querySelector(".chart[data-chart='overview']");
  const lines = [...document.querySelectorAll(".chart[data-chart='overview'] .chart__line")].map((l) => ({
    cls: l.getAttribute("class"),
    stroke: l.getAttribute("stroke"),
    dash: l.getAttribute("stroke-dasharray"),
    d: (l.getAttribute("d") || "").slice(0, 180),
  }));
  const historyText = document.querySelector(".chart-panel .panel__sub")?.innerText;
  const labels = [...document.querySelectorAll(".chart[data-chart='overview'] .chart__axis")].map((t) => t.textContent);
  return JSON.stringify({ cls: chart?.getAttribute("class"), historyText, labels, lines });
})()
