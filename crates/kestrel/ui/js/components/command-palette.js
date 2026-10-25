import { icon } from "../icons.js";
import { escapeHtml, healthTone } from "../format.js";
import { state } from "../store.js";

let items = [];
let onSelect = () => {};

export function configurePalette(handler) {
  onSelect = handler;
}

function pageItems() {
  return [
    { id: "nav-overview", group: "Navigate", title: "Overview", sub: "Cluster vitals, signals, attention queue", icon: "grid", action: { type: "navigate", route: "overview" } },
    { id: "nav-workloads", group: "Navigate", title: "Workloads", sub: "Pods, deployments, statefulsets, daemonsets", icon: "cube", action: { type: "navigate", route: "workloads" } },
    { id: "nav-nodes", group: "Navigate", title: "Nodes", sub: "Capacity, pressure, topology", icon: "server", action: { type: "navigate", route: "nodes" } },
    { id: "nav-copilot", group: "Navigate", title: "AI Copilot", sub: "Diagnose and reason about the cluster", icon: "sparkles", action: { type: "navigate", route: "copilot" } },
    { id: "nav-security", group: "Navigate", title: "Security", sub: "Vulnerability reports and scan coverage", icon: "shield", action: { type: "navigate", route: "security" } },
    { id: "nav-settings", group: "Navigate", title: "Settings", sub: "Connection, providers, safety, appearance", icon: "settings", action: { type: "navigate", route: "settings" } },
  ];
}

function actionItems(state) {
  const selected = state.snapshot?.pods?.find((p) => `${p.namespace}/${p.name}` === state.selectedPodKey);
  const out = [
    { id: "act-refresh", group: "Actions", title: "Refresh cluster snapshot", sub: "Pull the latest state from the API server", icon: "refresh", action: { type: "refresh" } },
    { id: "act-theme", group: "Actions", title: state.theme === "dark" ? "Switch to light mode" : "Switch to dark mode", sub: "Change the interface palette", icon: state.theme === "dark" ? "sun" : "moon", action: { type: "theme" } },
    { id: "act-settings", group: "Actions", title: "Configure AI providers", sub: "Ollama, Gemini, OpenRouter, Anthropic, Copilot", icon: "sparkles", action: { type: "navigate", route: "settings", tab: "providers" } },
    { id: "act-audit", group: "Actions", title: "Open audit log", sub: "Review every mutation and block", icon: "logs", action: { type: "navigate", route: "settings", tab: "audit" } },
  ];
  if (selected) {
    out.unshift({
      id: "act-diagnose",
      group: "Actions",
      title: `Diagnose ${selected.name}`,
      sub: `${selected.namespace} · ${selected.status || selected.phase}`,
      icon: "wand",
      action: { type: "diagnose", namespace: selected.namespace, name: selected.name },
    });
    out.push({
      id: "act-open-selected",
      group: "Actions",
      title: `Inspect ${selected.name}`,
      sub: "Open the pod drawer",
      icon: "eye",
      action: { type: "pod", namespace: selected.namespace, name: selected.name },
    });
  }
  return out;
}

function podItems(state) {
  return (state.snapshot?.pods || [])
    .slice()
    .sort((a, b) => {
      const rank = { failed: 0, pending: 1, warning: 2, healthy: 3, unknown: 4 };
      return (rank[a.health] ?? 5) - (rank[b.health] ?? 5);
    })
    .map((p) => ({
      id: `pod-${p.namespace}-${p.name}`,
      group: "Pods",
      title: p.name,
      sub: `${p.namespace} · ${p.status || p.phase} · ${p.ready} ready`,
      icon: "cube",
      tone: healthTone(p.health),
      action: { type: "pod", namespace: p.namespace, name: p.name },
    }));
}

export function buildPalette(state) {
  const q = state.palette.query.trim().toLowerCase();
  const all = [...pageItems(), ...actionItems(state), ...podItems(state)];
  if (!q) {
    const priority = all.filter(
      (i) =>
        i.group === "Navigate" ||
        i.group === "Actions" ||
        (i.group === "Pods" && ["critical", "warning"].includes(i.tone))
    );
    return priority.slice(0, 18);
  }
  return all
    .map((item) => {
      const hay = `${item.title} ${item.sub} ${item.group}`.toLowerCase();
      const idx = hay.indexOf(q);
      let score = idx === -1 ? 999 : idx;
      if (item.title.toLowerCase().startsWith(q)) score -= 100;
      return { ...item, score };
    })
    .filter((i) => i.score < 999)
    .sort((a, b) => a.score - b.score)
    .slice(0, 24);
}

export function renderPalette(state) {
  const host = document.getElementById("palette-results");
  if (!host) return;
  items = buildPalette(state);
  if (state.palette.index >= items.length) state.palette.index = 0;
  if (!items.length) {
    host.innerHTML = `<div class="palette__empty">No results for “${escapeHtml(state.palette.query)}”</div>`;
    return;
  }
  let lastGroup = "";
  const html = [];
  items.forEach((item, i) => {
    if (item.group !== lastGroup) {
      lastGroup = item.group;
      html.push(`<div class="palette__group">${escapeHtml(item.group)}</div>`);
    }
    html.push(`<button class="palette__item${i === state.palette.index ? " is-selected" : ""}" data-palette-index="${i}" role="option" aria-selected="${i === state.palette.index}">
      <span class="palette__item-icon">${icon(item.icon)}</span>
      <span class="palette__item-text">
        <span class="palette__item-title">${escapeHtml(item.title)}</span>
        <span class="palette__item-sub">${escapeHtml(item.sub)}</span>
      </span>
      ${item.tone ? `<span class="badge badge--dot" data-tone="${item.tone}">${item.tone === "critical" ? "issue" : item.tone}</span>` : ""}
      <span class="palette__item-end">↵</span>
    </button>`);
  });
  host.innerHTML = html.join("");
}

export function paletteMove(delta) {
  if (!items.length) return;
  const max = items.length;
  state.palette.index = (state.palette.index + delta + max) % max;
}

export function paletteSelect(index) {
  const item = items[index];
  if (!item) return;
  onSelect(item);
}

export function paletteItems() {
  return items;
}
