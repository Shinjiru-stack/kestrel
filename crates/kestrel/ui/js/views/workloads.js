import { icon } from "../icons.js";
import {
  escapeHtml,
  fmtAge,
  fmtBytes,
  fmtCpu,
  fmtDateTime,
  healthTone,
  statusTone,
} from "../format.js";

const PAGE_SIZE = 14;

const kindIcon = {
  Deployment: "layers",
  StatefulSet: "database",
  DaemonSet: "server",
  Pod: "cube",
};

function tabCount(state, kind) {
  const snapshot = state.snapshot;
  if (!snapshot) return 0;
  if (kind === "pods") return snapshot.pods?.length || 0;
  if (kind === "events") return snapshot.events?.length || 0;
  return (snapshot.workloads || []).filter((w) => w.kind === kind).length;
}

function tabs(state) {
  const current = state.filters.kind || "pods";
  const items = [
    ["pods", "Pods"],
    ["Deployment", "Deployments"],
    ["StatefulSet", "StatefulSets"],
    ["DaemonSet", "DaemonSets"],
    ["events", "Events"],
  ];
  return `<div class="segmented" role="tablist">
    ${items
      .map(
        ([kind, label]) =>
          `<button class="${current === kind ? "is-active" : ""}" data-action="workloads-kind" data-kind="${kind}" role="tab">${label}<span class="count">${tabCount(state, kind)}</span></button>`
      )
      .join("")}
  </div>`;
}

function namespaces(state) {
  const current = state.filters.namespace || "all";
  return `<select class="select" data-action="workloads-namespace" aria-label="Filter by namespace">
    <option value="all"${current === "all" ? " selected" : ""}>All namespaces</option>
    ${(state.snapshot?.namespaces || [])
      .map((ns) => `<option value="${escapeHtml(ns.name)}"${current === ns.name ? " selected" : ""}>${escapeHtml(ns.name)}</option>`)
      .join("")}
  </select>`;
}

function healthFilter(state) {
  const current = state.filters.health || "all";
  const options = [
    ["all", "All health"],
    ["healthy", "Healthy"],
    ["warning", "Degraded"],
    ["failed", "Failed"],
    ["pending", "Pending"],
  ];
  return `<select class="select" data-action="workloads-health" aria-label="Filter by health">
    ${options.map(([value, label]) => `<option value="${value}"${current === value ? " selected" : ""}>${label}</option>`).join("")}
  </select>`;
}

function matchesSearch(pod, q) {
  if (!q) return true;
  const hay = `${pod.name} ${pod.namespace} ${pod.status} ${pod.phase} ${pod.node} ${pod.owner?.name || ""}`.toLowerCase();
  return hay.includes(q);
}

function filterPods(state) {
  const f = state.filters;
  const q = (f.search || "").trim().toLowerCase();
  return (state.snapshot?.pods || []).filter((p) => {
    if (f.namespace !== "all" && p.namespace !== f.namespace) return false;
    if (f.health !== "all" && p.health !== f.health) return false;
    return matchesSearch(p, q);
  });
}

function filterWorkloads(state, kind) {
  const f = state.filters;
  const q = (f.search || "").trim().toLowerCase();
  return (state.snapshot?.workloads || []).filter((w) => {
    if (w.kind !== kind) return false;
    if (f.namespace !== "all" && w.namespace !== f.namespace) return false;
    if (f.health === "failed" && w.ready >= w.desired) return false;
    if (f.health === "healthy" && w.ready < w.desired) return false;
    if (f.health === "warning" && w.ready >= w.desired) return false;
    if (f.health === "pending") return false;
    if (!q) return true;
    return `${w.name} ${w.namespace} ${w.kind} ${w.status}`.toLowerCase().includes(q);
  });
}

function filterEvents(state) {
  const f = state.filters;
  const q = (f.search || "").trim().toLowerCase();
  return (state.snapshot?.events || []).filter((e) => {
    if (f.namespace !== "all" && e.namespace !== f.namespace) return false;
    if (f.health === "failed" && e.type !== "Warning") return false;
    if (f.health === "healthy" && e.type === "Warning") return false;
    if (!q) return true;
    return `${e.reason} ${e.message} ${e.involvedName} ${e.namespace}`.toLowerCase().includes(q);
  });
}

function sortRows(rows, state) {
  const sort = state.filters.sort || "health";
  const dir = state.filters.sortDir === "desc" ? -1 : 1;
  const rank = { failed: 0, pending: 1, warning: 2, healthy: 3, unknown: 4 };
  return [...rows].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name) * dir;
    if (sort === "restarts") return ((a.restarts || 0) - (b.restarts || 0)) * -dir;
    if (sort === "age") return ((a.ageSeconds || 0) - (b.ageSeconds || 0)) * -dir;
    if (sort === "namespace") return a.namespace.localeCompare(b.namespace) * dir;
    return ((rank[a.health] ?? 5) - (rank[b.health] ?? 5)) * dir;
  });
}

function pagination(total, page, action) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const nums = new Set([1, pages, current - 1, current, current + 1]);
  const sorted = [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of sorted) {
    if (prev && n - prev > 1) out.push(`<span class="faint mono" style="padding:0 3px">…</span>`);
    out.push(`<button class="${n === current ? "is-active" : ""}" data-action="${action}" data-page="${n}">${n}</button>`);
    prev = n;
  }
  return `<div class="pagination">
    <button data-action="${action}" data-page="${Math.max(1, current - 1)}" ${current === 1 ? "disabled" : ""} aria-label="Previous page">${icon("chevron-left")}</button>
    ${out.join("")}
    <button data-action="${action}" data-page="${Math.min(pages, current + 1)}" ${current === pages ? "disabled" : ""} aria-label="Next page">${icon("chevron-right")}</button>
  </div>`;
}

function readyCell(ready, desired) {
  const ratio = desired > 0 ? Math.min(1, ready / desired) : 0;
  const tone = ratio >= 1 ? "success" : ratio > 0 ? "warning" : "critical";
  return `<span class="ready-cell"><span class="bar"><i data-tone="${tone}" style="width:${Math.round(ratio * 100)}%"></i></span>${ready}/${desired}</span>`;
}

function podRow(p, state) {
  const key = `${p.namespace}/${p.name}`;
  const tone = healthTone(p.health);
  const restartTone = p.restarts > 10 ? "critical" : p.restarts > 2 ? "warning" : "";
  return `<tr class="${state.selectedPodKey === key ? "is-selected" : ""}" data-action="open-pod" data-namespace="${escapeHtml(p.namespace)}" data-name="${escapeHtml(p.name)}" data-tab="overview">
    <td>
      <div class="cell-primary">
        <span class="health-dot" data-health="${escapeHtml(p.health)}"></span>
        <div class="cell-primary__text">
          <span class="cell-primary__name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
          <span class="cell-primary__sub">${escapeHtml(p.owner?.kind || "Pod")}/${escapeHtml(p.owner?.name || p.name)}</span>
        </div>
      </div>
    </td>
    <td><span class="badge"><i class="namespace-dot" data-ns="${escapeHtml(p.namespace)}" style="margin-right:5px"></i>${escapeHtml(p.namespace)}</span></td>
    <td><span class="badge badge--dot" data-tone="${statusTone(p.status || p.phase)}">${escapeHtml(p.status || p.phase)}</span></td>
    <td><span class="ready-cell"><span class="bar"><i data-tone="${p.ready?.split("/")[0] === p.ready?.split("/")[1] ? "success" : "warning"}" style="width:${p.ready?.split("/")[1] ? Math.round((Number(p.ready.split("/")[0]) / Number(p.ready.split("/")[1])) * 100) : 0}%"></i></span>${escapeHtml(p.ready)}</span></td>
    <td><span class="restart-count" data-tone="${restartTone}">${p.restarts}</span></td>
    <td><span class="usage-cell">${p.cpuUsage == null ? "—" : fmtCpu(p.cpuUsage)}<span class="bar"><i style="width:${Math.min(100, (Number(p.cpuUsage) || 0) * 100)}%"></i></span></span></td>
    <td><span class="usage-cell">${p.memoryUsage == null ? "—" : fmtBytes(p.memoryUsage)}<span class="bar"><i style="width:${Math.min(100, ((Number(p.memoryUsage) || 0) / (512 * 1024 ** 2)) * 100)}%"></i></span></span></td>
    <td><span class="cell-mono">${escapeHtml(p.node || "—")}</span></td>
    <td><span class="cell-mono">${fmtAge(p.ageSeconds)}</span></td>
    <td>
      <span class="cell-actions">
        <button data-action="pod-logs" data-namespace="${escapeHtml(p.namespace)}" data-name="${escapeHtml(p.name)}" title="View logs">${icon("logs")}</button>
        <button data-action="pod-diagnose" data-namespace="${escapeHtml(p.namespace)}" data-name="${escapeHtml(p.name)}" title="Diagnose with AI">${icon("sparkles")}</button>
        <button data-action="open-pod" data-namespace="${escapeHtml(p.namespace)}" data-name="${escapeHtml(p.name)}" data-tab="overview" title="Inspect pod">${icon("chevron-right")}</button>
      </span>
    </td>
  </tr>`;
}

function workloadRow(w) {
  const healthy = w.ready >= w.desired && w.desired > 0;
  return `<tr data-action="workload-drill" data-name="${escapeHtml(w.name)}" data-namespace="${escapeHtml(w.namespace)}" data-kind="${escapeHtml(w.kind)}">
    <td>
      <div class="cell-primary">
        <span class="workload-kind-icon" data-kind="${escapeHtml(w.kind)}">${icon(kindIcon[w.kind] || "layers")}</span>
        <div class="cell-primary__text">
          <span class="cell-primary__name" title="${escapeHtml(w.name)}">${escapeHtml(w.name)}</span>
          <span class="cell-primary__sub">${escapeHtml(w.kind)} · ${escapeHtml(w.namespace)}</span>
        </div>
      </div>
    </td>
    <td><span class="cell-mono">${escapeHtml(w.namespace)}</span></td>
    <td>${readyCell(w.ready, w.desired)}</td>
    <td><span class="cell-mono">${w.updated}/${w.desired}</span></td>
    <td><span class="cell-mono">${w.available}/${w.desired}</span></td>
    <td><span class="badge badge--dot" data-tone="${healthy ? "success" : statusTone(w.status)}">${escapeHtml(w.status)}</span></td>
    <td><span class="cell-mono">${fmtAge(w.ageSeconds)}</span></td>
    <td>
      <span class="cell-actions">
        <button data-action="workload-drill" data-name="${escapeHtml(w.name)}" data-namespace="${escapeHtml(w.namespace)}" data-kind="${escapeHtml(w.kind)}" title="Show pods">${icon("filter")}</button>
        <button data-action="open-copilot-workload" data-name="${escapeHtml(w.name)}" data-namespace="${escapeHtml(w.namespace)}" title="Ask Copilot">${icon("sparkles")}</button>
      </span>
    </td>
  </tr>`;
}

function eventRow(e) {
  const pod = e.involvedKind === "Pod" ? ` data-action="open-pod" data-namespace="${escapeHtml(e.namespace)}" data-name="${escapeHtml(e.involvedName)}" data-tab="events"` : "";
  return `<tr${pod}>
    <td><span class="badge badge--dot" data-tone="${e.type === "Warning" ? "warning" : "success"}">${escapeHtml(e.type)}</span></td>
    <td><span class="cell-strong">${escapeHtml(e.reason)}</span></td>
    <td>
      <div class="cell-primary__text">
        <span class="cell-primary__name">${escapeHtml(e.involvedName || "—")}</span>
        <span class="cell-primary__sub">${escapeHtml(e.involvedKind || "Object")}</span>
      </div>
    </td>
    <td><span class="cell-mono">${escapeHtml(e.namespace)}</span></td>
    <td><span class="badge" data-tone="${e.count > 1 ? "warning" : "neutral"}">×${e.count}</span></td>
    <td><span class="cell-mono">${fmtDateTime(e.lastSeen)}</span></td>
    <td><span class="cell-mono">${escapeHtml(e.source || "kubelet")}</span></td>
    <td><span class="cell-mono">${fmtAge(e.ageSeconds)}</span></td>
  </tr>`;
}

function podTable(rows, state) {
  if (!rows.length) {
    return `<div class="table-empty">${icon("search")}<strong>No pods match this view</strong><span>Try a different namespace, health filter, or search term.</span></div>`;
  }
  return `<div class="table-wrap">
    <table class="data-table">
      <thead><tr>
        <th>Pod</th><th>Namespace</th><th>Status</th><th>Ready</th><th>Restarts</th><th>CPU</th><th>Memory</th><th>Node</th><th>Age</th><th></th>
      </tr></thead>
      <tbody>${rows.map((p) => podRow(p, state)).join("")}</tbody>
    </table>
  </div>`;
}

function workloadTable(rows, kind) {
  if (!rows.length) {
    return `<div class="table-empty">${icon("layers")}<strong>No ${escapeHtml(kind.toLowerCase())} match this view</strong><span>Try a different namespace, health filter, or search term.</span></div>`;
  }
  return `<div class="table-wrap">
    <table class="data-table">
      <thead><tr>
        <th>${escapeHtml(kind.replace(/s$/, ""))}</th><th>Namespace</th><th>Ready</th><th>Updated</th><th>Available</th><th>Status</th><th>Age</th><th></th>
      </tr></thead>
      <tbody>${rows.map(workloadRow).join("")}</tbody>
    </table>
  </div>`;
}

function eventTable(rows) {
  if (!rows.length) {
    return `<div class="table-empty">${icon("bell-off")}<strong>No events match this view</strong><span>The API server may have aged out older events, or the filter is too narrow.</span></div>`;
  }
  return `<div class="table-wrap">
    <table class="data-table">
      <thead><tr>
        <th>Type</th><th>Reason</th><th>Object</th><th>Namespace</th><th>Count</th><th>Last seen</th><th>Source</th><th>Age</th>
      </tr></thead>
      <tbody>${rows.map(eventRow).join("")}</tbody>
    </table>
  </div>`;
}

export function renderWorkloads(state) {
  const snapshot = state.snapshot;
  if (!snapshot) return "";
  const kind = state.filters.kind || "pods";
  const all =
    kind === "pods"
      ? sortRows(filterPods(state), state)
      : kind === "events"
        ? filterEvents(state)
        : filterWorkloads(state, kind);
  const page = state.filters.page || 1;
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const rows = all.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pods = snapshot.pods || [];
  const failed = pods.filter((p) => p.health === "failed").length;
  const attention = pods.filter((p) => p.health !== "healthy").length;
  const restarts = pods.reduce((sum, p) => sum + (Number(p.restarts) || 0), 0);
  const searchValue = state.filters.search || "";
  const table =
    kind === "pods"
      ? podTable(rows, state)
      : kind === "events"
        ? eventTable(rows)
        : workloadTable(rows, kind);

  return `<div class="page-head">
    <div class="page-head__main">
      <div class="page-head__eyebrow"><span class="status-dot" data-status="${state.connected ? "connected" : "connecting"}"></span><span class="eyebrow">Operate · ${escapeHtml(snapshot.cluster.name)}</span></div>
      <h1 class="page-title">Workloads</h1>
      <p class="page-desc">Every pod, controller, and event on one surface. ${pods.length} pods · ${attention} need attention · ${failed} failing · ${restarts} restarts observed.</p>
    </div>
    <div class="page-head__actions">
      <button class="btn btn--ghost" data-action="refresh">${icon("refresh")} Refresh</button>
      <button class="btn btn--primary" data-action="open-copilot">${icon("sparkles")} Ask Copilot</button>
    </div>
  </div>

  <div class="panel workloads-panel">
    <div class="workloads-toolbar">
      <div class="workloads-toolbar__left">${tabs(state)}</div>
      <div class="workloads-toolbar__right">
        ${namespaces(state)}
        <div class="search-field">
          ${icon("search")}
          <input id="workloads-search" type="text" placeholder="Filter ${escapeHtml(kind === "events" ? "events" : kind === "pods" ? "pods" : "controllers")}…" value="${escapeHtml(searchValue)}" data-action="workloads-search" autocomplete="off" spellcheck="false" />
        </div>
        ${kind !== "events" ? healthFilter(state) : ""}
      </div>
    </div>
    ${table}
    <div class="workload-footer">
      <span>${all.length ? `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, all.length)} of ${all.length}` : "0 results"} · page ${safePage} of ${pages}</span>
      ${pagination(all.length, safePage, "workloads-page")}
    </div>
  </div>`;
}
