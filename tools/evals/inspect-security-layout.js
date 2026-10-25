(async () => {
  location.hash = "#/security";
  await new Promise((r) => setTimeout(r, 2500));
  const list = document.querySelector(".report-list");
  const left = list?.closest(".panel");
  const right = document.querySelectorAll(".grid--12 > .panel")[1];
  return JSON.stringify({
    rows: list?.querySelectorAll(".report-row").length,
    listRect: list ? { h: list.clientHeight, sh: list.scrollHeight, top: list.getBoundingClientRect().top, bottom: list.getBoundingClientRect().bottom } : null,
    leftRect: left ? { h: left.clientHeight, top: left.getBoundingClientRect().top, bottom: left.getBoundingClientRect().bottom } : null,
    rightRect: right ? { h: right.clientHeight, top: right.getBoundingClientRect().top, bottom: right.getBoundingClientRect().bottom } : null,
    footRect: left?.querySelector(".panel__foot")?.getBoundingClientRect().toJSON() || null,
    listStyle: list ? { maxHeight: getComputedStyle(list).maxHeight, flex: getComputedStyle(list).flex, overflow: getComputedStyle(list).overflowY } : null,
  });
})()
