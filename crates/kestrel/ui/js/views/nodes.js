import { icon } from "../icons.js";
import { escapeHtml, fmtAge, fmtBytes, fmtCpu, pct, statusTone } from "../format.js";
import { nodeRing } from "../components/charts.js";

function conditionTone(condition) {
  if (condition.type === "Ready") return condition.status === "True" ? "success" : "critical";
  return condition.status === "False" ? "success" : "warning";
}

function nodeCard(node) {
  const cpuPct = pct(node.cpuUsage || 0, node.cpuCores || 1);
  const memPct = pct(node.memoryUsage || 0, node.memoryBytes || 1);
  const podPct = pct(node.pods || 0, node.podCapacity || 1);
  const ready = node.status === "Ready";
  return `<article class="node-card">
    <div class="node-card__head">
      <div class="node-ring">
        ${nodeRing(Math.max(cpuPct, memPct), { size: 58, stroke: 4 })}
        <div class="node-ring__center">${Math.round(cpuPct)}%</div>
      </div>
      <div class="node-card__title">
        <div class="node-card__name"><span class="health-dot" data-health="${ready ? "healthy" : "failed"}"></span>${escapeHtml(node.name)}</div>
        <div class="node-card__meta">
          <span>${escapeHtml(node.version || "unknown")}</span>
          <span>·</span>
          <span>${escapeHtml(node.internalIp || "—")}</span>
          <span>·</span>
          <span>${fmtAge(node.ageSeconds)}</span>
        </div>
        <div class="node-card__roles">
          ${(node.roles?.length ? node.roles : ["worker"]).map((r) => `<span class="badge" data-tone="${r.includes("control") ? "violet" : "info"}">${escapeHtml(r)}</span>`).join("")}
          <span class="badge" data-tone="${statusTone(node.status)}">${escapeHtml(node.status)}</span>
        </div>
      </div>
      <button class="btn btn--sm btn--ghost" data-action="node-pods" data-node="${escapeHtml(node.name)}" title="Show pods on this node">${icon("filter")}</button>
    </div>
    <div class="node-card__body">
      <div class="capacity-row">
        <div class="capacity-row__head"><span>CPU</span><span><strong>${fmtCpu(node.cpuUsage || 0)}</strong> / ${escapeHtml(node.cpuCapacity || fmtCpu(node.cpuCores))}</span></div>
        <div class="capacity-bar"><i data-tone="${cpuPct > 85 ? "critical" : cpuPct > 70 ? "warning" : ""}" style="width:${cpuPct}%"></i></div>
      </div>
      <div class="capacity-row">
        <div class="capacity-row__head"><span>Memory</span><span><strong>${fmtBytes(node.memoryUsage || 0)}</strong> / ${node.memoryBytes ? fmtBytes(node.memoryBytes) : escapeHtml(node.memoryCapacity || "—")}</span></div>
        <div class="capacity-bar"><i data-tone="${memPct > 85 ? "critical" : memPct > 70 ? "warning" : "cyan"}" style="width:${memPct}%"></i></div>
      </div>
      <div class="capacity-row">
        <div class="capacity-row__head"><span>Pod slots</span><span><strong>${node.pods}</strong> / ${node.podCapacity}</span></div>
        <div class="capacity-bar"><i data-tone="${podPct > 85 ? "warning" : ""}" style="width:${podPct}%"></i></div>
      </div>
    </div>
    <div class="node-card__foot">
      <div class="node-conditions">
        ${(node.conditions || [])
          .filter((c) => c.type === "Ready" || c.type.endsWith("Pressure"))
          .slice(0, 4)
          .map((c) => `<span class="badge badge--dot" data-tone="${conditionTone(c)}">${escapeHtml(c.type.replace("Pressure", ""))}</span>`)
          .join("")}
      </div>
      <span>${node.taints?.length ? `${node.taints.length} taint${node.taints.length === 1 ? "" : "s"}` : "no taints"}</span>
    </div>
  </article>`;
}

function topology(nodes) {
  const control = nodes.filter((n) => n.roles?.some((r) => r.includes("control-plane") || r.includes("master")));
  const workers = nodes.filter((n) => !control.includes(n));
  const ordered = [...control, ...workers];
  return `<div class="node-topology">
    ${ordered
      .map((node, i) => {
        const role = control.includes(node) ? "control plane" : "worker";
        return `${i ? `<span class="topo-link"></span>` : ""}
          <div class="topo-node">
            <div class="topo-node__orb" data-role="${role}">${icon(control.includes(node) ? "layers" : "server")}</div>
            <div class="topo-node__label">${escapeHtml(node.name)}</div>
            <div class="topo-node__label" style="color:var(--text-faint)">${role}</div>
          </div>`;
      })
      .join("")}
    ${!ordered.length ? `<div class="empty"><div class="empty__title">No nodes reported</div></div>` : ""}
  </div>`;
}

export function renderNodes(state) {
  const snapshot = state.snapshot;
  if (!snapshot) return "";
  const nodes = snapshot.nodes || [];
  const ready = nodes.filter((n) => n.status === "Ready").length;
  const cpuUsage = nodes.reduce((sum, n) => sum + (Number(n.cpuUsage) || 0), 0);
  const cpuCapacity = nodes.reduce((sum, n) => sum + (Number(n.cpuCores) || 0), 0) || 1;
  const memUsage = nodes.reduce((sum, n) => sum + (Number(n.memoryUsage) || 0), 0);
  const memCapacity = nodes.reduce((sum, n) => sum + (Number(n.memoryBytes) || 0), 0) || 1;
  const pods = nodes.reduce((sum, n) => sum + (Number(n.pods) || 0), 0);
  const podCapacity = nodes.reduce((sum, n) => sum + (Number(n.podCapacity) || 0), 0) || 1;
  const pressure = nodes.filter((n) =>
    (n.conditions || []).some((c) => c.type.endsWith("Pressure") && c.status === "True")
  ).length;

  return `<div class="page-head">
    <div class="page-head__main">
      <div class="page-head__eyebrow"><span class="status-dot" data-status="${state.connected ? "connected" : "connecting"}"></span><span class="eyebrow">Operate · capacity and pressure</span></div>
      <h1 class="page-title">Nodes</h1>
      <p class="page-desc">${ready} of ${nodes.length} nodes are ready. Aggregate CPU is ${Math.round(pct(cpuUsage, cpuCapacity))}% and memory is ${Math.round(pct(memUsage, memCapacity))}% committed. ${pressure ? `${pressure} pressure condition${pressure === 1 ? "" : "s"} active.` : "No pressure conditions are active."}</p>
    </div>
    <div class="page-head__actions">
      <button class="btn btn--ghost" data-action="refresh">${icon("refresh")} Refresh</button>
      <button class="btn btn--primary" data-action="open-copilot">${icon("sparkles")} Ask Copilot</button>
    </div>
  </div>

  <div class="grid grid--4">
    <div class="stat-card" data-tone="mint">
      <div class="stat-card__head"><span class="stat-card__label">Nodes ready</span><span class="stat-card__icon">${icon("server")}</span></div>
      <div class="stat-card__value">${ready}<small>/${nodes.length}</small></div>
      <div class="stat-card__foot"><span>${nodes.length - ready} unavailable</span><span class="delta" data-tone="${nodes.length - ready ? "bad" : "good"}">${nodes.length - ready ? "attention" : "all ready"}</span></div>
    </div>
    <div class="stat-card" data-tone="cyan">
      <div class="stat-card__head"><span class="stat-card__label">CPU committed</span><span class="stat-card__icon">${icon("cpu")}</span></div>
      <div class="stat-card__value">${Math.round(pct(cpuUsage, cpuCapacity))}<small>%</small></div>
      <div class="stat-card__foot"><span>${fmtCpu(cpuUsage)} of ${fmtCpu(cpuCapacity)} cores</span><span class="delta" data-tone="${pct(cpuUsage, cpuCapacity) > 80 ? "bad" : "neutral"}">${pct(cpuUsage, cpuCapacity) > 80 ? "high" : "headroom"}</span></div>
    </div>
    <div class="stat-card" data-tone="violet">
      <div class="stat-card__head"><span class="stat-card__label">Memory committed</span><span class="stat-card__icon">${icon("memory")}</span></div>
      <div class="stat-card__value">${Math.round(pct(memUsage, memCapacity))}<small>%</small></div>
      <div class="stat-card__foot"><span>${fmtBytes(memUsage)} of ${fmtBytes(memCapacity)}</span><span class="delta" data-tone="${pct(memUsage, memCapacity) > 80 ? "bad" : "neutral"}">${pct(memUsage, memCapacity) > 80 ? "high" : "headroom"}</span></div>
    </div>
    <div class="stat-card" data-tone="amber">
      <div class="stat-card__head"><span class="stat-card__label">Pod slots</span><span class="stat-card__icon">${icon("cube")}</span></div>
      <div class="stat-card__value">${pods}<small>scheduled</small></div>
      <div class="stat-card__foot"><span>${podCapacity} slot capacity</span><span class="delta" data-tone="neutral">${Math.round(pct(pods, podCapacity))}% used</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section__head">
      <div class="section__title">Topology <span>${nodes.length} nodes · ${snapshot.cluster.provider}</span></div>
      <div class="section__actions"><span class="mono faint">${escapeHtml(snapshot.cluster.version)}</span></div>
    </div>
    ${topology(nodes)}
  </div>

  <div class="section">
    <div class="section__head">
      <div class="section__title">Capacity <span>live kubelet metrics</span></div>
      <div class="section__actions"><span class="mono faint">${snapshot.metricsAvailable ? "metrics-server available" : "metrics unavailable"}</span></div>
    </div>
    <div class="nodes-grid">${nodes.map(nodeCard).join("")}</div>
  </div>`;
}
