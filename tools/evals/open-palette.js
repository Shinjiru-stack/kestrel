(async () => {
  location.hash = "#/overview";
  await new Promise((r) => setTimeout(r, 700));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  return JSON.stringify({
    open: document.getElementById("command-palette")?.hidden === false,
    items: [...document.querySelectorAll(".palette__item")].length,
    text: document.getElementById("command-palette")?.innerText?.slice(0, 500) || "",
  });
})()
