(() => {
  const wrap = document.querySelector(".table-wrap");
  const table = document.querySelector(".data-table");
  const drawer = document.getElementById("drawer");
  const content = document.getElementById("drawer-content");
  return JSON.stringify({
    wrap: wrap ? { clientWidth: wrap.clientWidth, scrollWidth: wrap.scrollWidth, clientHeight: wrap.clientHeight, scrollHeight: wrap.scrollHeight } : null,
    table: table ? { width: Math.round(table.getBoundingClientRect().width) } : null,
    drawer: drawer ? { hidden: drawer.hidden, width: drawer.getBoundingClientRect().width } : null,
    drawerText: (content?.innerText || "").slice(0, 240),
  });
})()
