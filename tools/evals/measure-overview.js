(() => {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), scrollH: el.scrollHeight };
  };
  return JSON.stringify({
    viewport: { w: innerWidth, h: innerHeight },
    body: { scrollH: document.body.scrollHeight, clientH: document.body.clientHeight },
    main: rect("main"),
    chartPanel: rect(".chart-panel"),
    chartWrap: rect(".chart-wrap"),
    chart: rect(".chart"),
    attention: rect(".attention-panel"),
    brief: rect(".brief-card"),
    lowerGrid: rect(".overview-grid--lower") || rect(".overview-lower"),
    stats: rect(".stat-grid"),
  });
})()
