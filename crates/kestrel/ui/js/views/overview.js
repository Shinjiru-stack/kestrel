import { icon } from "../icons.js";
import {
  escapeHtml,
  fmtAge,
  fmtClock,
  fmtNumber,
  healthTone,
  severityTone,
  statusTone,
  pct,
} from "../format.js";
import { areaChart, ring, sparkline } from "../components/charts.js";

function historyFor(state) {
  const history = state.history?.length ? state.history : state.snapshot?.history || [];
  return history.slice(-36);
}

function clusterStats(snapshot) {
  const pods = snapshot?.pods || [];
  const nodes = snapshot?.nodes || [];
  const workloads = snapshot?.workloads || [];
  const healthy = pods.filter((p) => p.health === "healthy").length;
  const attention = pods.filter((p) => p.health !== "healthy").length;
  const failed = pods.filter((p) => p.health === "failed").length;
  const warning = pods.filter((p) => p.health === "warning" || p.health === "pending").length;
  const restarts = pods.reduce((sum, p) => sum + (Number(p.restarts) || 0), 0);
  const restartedPods = pods.filter((p) => (Number(p.restarts) || 0) > 0).length;
  const readyNodes = nodes.filter((n) => n.status === "Ready").length;
  const degradedWorkloads = workloads.filter((w) => w.ready < w.desired).length;
  const cpu = nodes.length
    ? nodes.reduce((sum, n) => sum + (Number(n.cpuUsage) || 0), 0) / nodes.reduce((sum, n) => sum + (Number(n.cpuCores) || 1), 0)
    : 0;
  const memory = nodes.length
    ? nodes.reduce((sum, n) => sum + (Number(n.memoryUsage) || 0), 0) / nodes.reduce((sum, n) => sum + (Number(n.memoryBytes) || 1), 0)
    : 0;
  const score = Math.max(28, Math.min(99, Math.round(100 - failed * 14 - warning * 7 - degradedWorkloads * 4 - Math.min(12, restarts / 4))));
  return { pods, nodes, workloads, healthy, attention, failed, warning, restarts, restartedPods, readyNodes, degradedWorkloads, cpu, memory, score };
}

function attentionPods(stats) {
  const rank = { failed: 0, pending: 1, warning: 2, healthy: 3, unknown: 4 };
  return stats.pods
    .filter((p) => p.health !== "healthy")
    .sort((a, b) => (rank[a.health] ?? 5) - (rank[b.health] ?? 5) || (b.restarts || 0) - (a.restarts || 0));
}

function healthCopy(score, stats) {
  if (score >= 88) return "The cluster is stable. No workload is blocking traffic.";
  if (score >= 72) return `${stats.attention} workload${stats.attention === 1 ? "" : "s"} need attention, but the control plane and healthy replicas are carrying traffic.`;
  if (score >= 55) return `${stats.failed} workload${stats.failed === 1 ? " is" : "s are"} failing and ${stats.warning} more are degraded. Triage the queue before it spreads.`;
  return "Multiple failure domains are active. Start with the highest restart count, then verify node pressure and scheduling.";
}

function topBriefing(stats, attention) {
  if (!attention.length) {
    return {
      summary: "All observed workloads are healthy. The cluster is quiet.",
      items: ["No crash loops or OOM kills detected.", "No pending pods or failed scheduling events.", "Resource headroom is within the configured guardrails."],
    };
  }
  const first = attention[0];
  const reasons = attention.slice(0, 3).map((p) => `${p.name.split("-").slice(0, 2).join("-")} (${p.status || p.phase})`);
  return {
    summary: `${attention.length} workload${attention.length === 1 ? "" : "s"} are degrading cluster health. ${first.name.split("-").slice(0, 2).join("-")} is the highest-priority signal.`,
    items: [
      `${first.namespace}/${first.name} · ${first.status || first.phase} · ${first.restarts} restarts.`,
      ...reasons.slice(1).map((r) => `Also watch ${r}.`),
      `${stats.degradedWorkloads} of ${stats.workloads.length} controllers are below desired replicas.`,
    ],
  };
}

export function renderOverview(state) {
  const snapshot = state.snapshot;
  if (!snapshot) return "";
  const stats = clusterStats(snapshot);
  const attention = attentionPods(stats);
  const history = historyFor(state);
  const cpuValues = history.map((h) => Number(h.cpu) || 0);
  const memValues = history.map((h) => Number(h.memory) || 0);
  const latestCpu = cpuValues[cpuValues.length - 1] || 0;
  const latestMem = memValues[memValues.length - 1] || 0;
  const warming = history.length < 3;
  const labels = warming
    ? ["now"]
    : history
        .filter((_, i) => i % 6 === 0 || i === history.length - 1)
        .map((h) => fmtClock(new Date(h.t)));
  const briefing = topBriefing(stats, attention);
  const provider = state.settings?.providers?.find((p) => p.kind === state.settings.activeProvider);
  const updated = snapshot.generatedAt ? fmtClock(new Date(snapshot.generatedAt)) : "just now";
  const scoreTone = stats.score >= 80 ? "var(--mint)" : stats.score >= 60 ? "var(--amber)" : "var(--coral)";

  return `<div class="page-head">
    <div class="page-head__main">
      <div class="page-head__eyebrow"><span class="status-dot" data-status="${state.connected ? "connected" : "connecting"}"></span><span class="eyebrow">Cluster observatory · ${escapeHtml(snapshot.cluster.name)}</span></div>
      <h1 class="page-title">Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, operator.</h1>
      <p class="page-desc">Live health, resource pressure, and the shortest path from symptom to remediation. Updated ${updated} · ${snapshot.cluster.latencyMs || 0}ms API latency.</p>
    </div>
    <div class="page-head__actions">
      <button class="btn btn--ghost" data-action="refresh">${icon("refresh")} Refresh</button>
      <button class="btn btn--primary" data-action="open-copilot">${icon("sparkles")} Ask Copilot</button>
    </div>
  </div>

  <div class="overview-top">
    <section class="panel panel--accent overview-hero">
      <div class="panel__head">
        <div class="panel__title">${icon("pulse")} Cluster health</div>
        <div class="panel__sub">score · live</div>
      </div>
      <div class="panel__body">
        <div class="health-hero">
          <div class="health-hero__gauge">
            ${ring(stats.score, { size: 144, stroke: 7, color: scoreTone })}
            <div class="health-hero__center">
              <div class="health-hero__score">${stats.score}<span>/100</span></div>
              <div class="health-hero__label">${stats.score >= 80 ? "stable" : stats.score >= 60 ? "degraded" : "critical"}</div>
            </div>
          </div>
          <div class="health-hero__copy">
            <h3>${stats.score >= 80 ? "The cluster is holding." : stats.score >= 60 ? "A few signals need a human." : "Multiple failure domains are active."}</h3>
            <p>${escapeHtml(healthCopy(stats.score, stats))}</p>
            <div class="health-hero__tags">
              <span class="badge badge--dot" data-tone="success">${stats.healthy} healthy</span>
              <span class="badge badge--dot" data-tone="critical">${stats.failed} failed</span>
              <span class="badge badge--dot" data-tone="warning">${stats.warning} degraded</span>
              <span class="badge">${stats.restarts} restarts</span>
            </div>
          </div>
        </div>
        <div class="mini-metrics">
          <div class="mini-metric"><span>Nodes ready</span><strong>${stats.readyNodes}<small>/${stats.nodes.length}</small></strong></div>
          <div class="mini-metric"><span>Workloads healthy</span><strong>${stats.workloads.length - stats.degradedWorkloads}<small>/${stats.workloads.length}</small></strong></div>
          <div class="mini-metric"><span>CPU pressure</span><strong>${Math.round(stats.cpu * 100)}<small>%</small></strong></div>
          <div class="mini-metric"><span>Memory pressure</span><strong>${Math.round(stats.memory * 100)}<small>%</small></strong></div>
        </div>
      </div>
    </section>

    <section class="brief-card">
      <div class="brief-card__head">
        <span class="brief-card__mark">${icon("sparkles")}</span>
        <span class="brief-card__title">AI briefing</span>
        <span class="brief-card__live">${provider?.label || "AI"} · live</span>
      </div>
      <p class="brief-card__summary">${escapeHtml(briefing.summary)}</p>
      <div class="brief-card__list">
        ${briefing.items.map((item) => `<span>${icon("arrow-right")} ${escapeHtml(item)}</span>`).join("")}
      </div>
      <div class="brief-card__evidence">
        <span>pod conditions</span><span>warning events</span><span>bounded logs</span><span>node metrics</span>
      </div>
      <div class="brief-card__confidence">
        <span>signal confidence</span>
        <span class="bar"><i data-tone="${attention.length > 3 ? "warning" : "success"}" style="width:${Math.min(96, 68 + attention.length * 5)}%"></i></span>
        <strong>${attention.length > 3 ? "moderate" : "high"}</strong>
      </div>
      <div class="brief-card__actions">
        ${
          attention.length
            ? `<button class="btn btn--sm btn--primary" data-action="open-pod" data-namespace="${escapeHtml(attention[0].namespace)}" data-name="${escapeHtml(attention[0].name)}" data-tab="ai">${icon("wand")} Diagnose top issue</button>`
            : `<button class="btn btn--sm btn--primary" data-action="open-copilot">${icon("sparkles")} Ask Copilot</button>`
        }
        <button class="btn btn--sm btn--ghost" data-action="open-copilot">Open Copilot ${icon("arrow-up-right")}</button>
      </div>
    </section>
  </div>

  <div class="grid grid--4" style="margin-top:14px">
    <div class="stat-card" data-tone="mint">
      <div class="stat-card__head"><span class="stat-card__label">Pods</span><span class="stat-card__icon">${icon("cube")}</span></div>
      <div class="stat-card__value">${stats.pods.length}<small>total</small></div>
      <div class="stat-card__foot"><span>${stats.healthy} healthy · ${stats.attention} attention</span><span class="delta" data-tone="${stats.failed ? "bad" : "good"}">${stats.failed ? `${stats.failed} failing` : "stable"}</span></div>
      <div class="stat-card__spark">${sparkline(cpuValues.slice(-18), { width: 88, height: 30, color: "var(--mint)", fill: true })}</div>
    </div>
    <div class="stat-card" data-tone="cyan">
      <div class="stat-card__head"><span class="stat-card__label">Workloads</span><span class="stat-card__icon">${icon("layers")}</span></div>
      <div class="stat-card__value">${stats.workloads.length}<small>controllers</small></div>
      <div class="stat-card__foot"><span>${stats.workloads.length - stats.degradedWorkloads} at desired replicas</span><span class="delta" data-tone="${stats.degradedWorkloads ? "bad" : "good"}">${stats.degradedWorkloads} degraded</span></div>
      <div class="stat-card__spark">${sparkline(memValues.slice(-18), { width: 88, height: 30, color: "var(--cyan)", fill: true })}</div>
    </div>
    <div class="stat-card" data-tone="amber">
      <div class="stat-card__head"><span class="stat-card__label">Restarts</span><span class="stat-card__icon">${icon("restart")}</span></div>
      <div class="stat-card__value">${stats.restarts}<small>observed</small></div>
      <div class="stat-card__foot"><span>${stats.restartedPods} pods affected</span><span class="delta" data-tone="${stats.restarts > 10 ? "bad" : "neutral"}">${stats.restarts > 10 ? "elevated" : "normal"}</span></div>
      <div class="stat-card__spark">${sparkline(cpuValues.slice(-18).map((v) => Math.min(1, v * 1.4)), { width: 88, height: 30, color: "var(--amber)", fill: true })}</div>
    </div>
    <div class="stat-card" data-tone="violet">
      <div class="stat-card__head"><span class="stat-card__label">Nodes</span><span class="stat-card__icon">${icon("server")}</span></div>
      <div class="stat-card__value">${stats.readyNodes}<small>ready</small></div>
      <div class="stat-card__foot"><span>${Math.round(stats.cpu * 100)}% CPU · ${Math.round(stats.memory * 100)}% mem</span><span class="delta" data-tone="neutral">${stats.nodes.length} total</span></div>
      <div class="stat-card__spark">${sparkline(cpuValues.slice(-18).map((v) => Math.max(0.2, Math.min(1, v + 0.2))), { width: 88, height: 30, color: "var(--violet)", fill: true })}</div>
    </div>
  </div>

  <div class="grid grid--12" style="margin-top:14px">
    <section class="panel chart-panel span-8">
      <div class="panel__head">
        <div>
          <div class="panel__title">${icon("activity")} Resource signal</div>
          <div class="panel__sub">${warming ? "live aggregate · collecting samples" : "cluster aggregate · live window"}</div>
        </div>
        <div class="chart-panel__legend">
          <span class="chart-legend__item"><i class="chart-legend__swatch"></i> CPU ${Math.round(latestCpu * 100)}%</span>
          <span class="chart-legend__item"><i class="chart-legend__swatch" data-tone="cyan"></i> Memory ${Math.round(latestMem * 100)}%</span>
        </div>
      </div>
      <div class="panel__body">
        <div class="chart-wrap">
          ${areaChart(
            [
              { name: "CPU", color: "var(--mint)", values: cpuValues.length ? cpuValues : [0.3] },
              { name: "Memory", color: "var(--cyan)", values: memValues.length ? memValues : [0.4] },
            ],
            { labels, height: 200, max: 1, min: 0, warming }
          )}
          ${
            warming
              ? `<div class="chart-warming"><div class="chart-warming__card"><span class="status-dot" data-status="connecting"></span><div><strong>Warming up live telemetry</strong><small>First samples arrive every 20 seconds.</small></div></div></div>`
              : ""
          }
        </div>
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">peak ${Math.round(Math.max(...cpuValues, 0) * 100)}% CPU · ${Math.round(Math.max(...memValues, 0) * 100)}% memory</span>
        <button class="panel__link" data-nav="nodes">Explore nodes ${icon("arrow-right")}</button>
      </div>
    </section>

    <section class="panel span-4">
      <div class="panel__head">
        <div class="panel__title">${icon("alert")} Attention required</div>
        <span class="badge badge--dot" data-tone="${attention.length ? "critical" : "success"}">${attention.length}</span>
      </div>
      <div class="attention-list">
        ${
          attention.length
            ? attention
                .slice(0, 6)
                .map(
                  (p) => `<div class="attention-item" data-action="open-pod" data-namespace="${escapeHtml(p.namespace)}" data-name="${escapeHtml(p.name)}" data-tab="overview">
                    <span class="health-dot" data-health="${escapeHtml(p.health)}"></span>
                    <div class="attention-item__body">
                      <div class="attention-item__name">${escapeHtml(p.name)}</div>
                      <div class="attention-item__meta"><span>${escapeHtml(p.namespace)}</span><span>·</span><span>${escapeHtml(p.status || p.phase)}</span><span>·</span><span>${p.restarts} restarts</span></div>
                    </div>
                    <div class="attention-item__end">
                      <span class="badge" data-tone="${severityTone(p.severity)}">${escapeHtml(p.severity || "warning")}</span>
                      ${icon("chevron-right")}
                    </div>
                  </div>`
                )
                .join("")
            : `<div class="empty" style="min-height:220px"><div class="empty__icon">${icon("check")}</div><div class="empty__title">Nothing needs attention</div><div class="empty__desc">All observed pods are ready. The Copilot can still look for trends.</div></div>`
        }
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">${stats.failed} failing · ${stats.warning} degraded</span>
        <button class="panel__link" data-nav="workloads">Open workloads ${icon("arrow-right")}</button>
      </div>
    </section>
  </div>

  <div class="grid grid--12" style="margin-top:14px">
    <section class="panel span-7">
      <div class="panel__head">
        <div class="panel__title">${icon("bell")} Event stream</div>
        <span class="pulse-line">LIVE</span>
      </div>
      <div class="timeline">
        ${
          (snapshot.events || []).slice(0, 7).map(
            (e) => `<div class="timeline__item">
              <span class="timeline__dot" data-tone="${e.type === "Warning" ? "warning" : "success"}"></span>
              <div class="timeline__body">
                <div class="timeline__title"><span>${escapeHtml(e.reason)}</span><span class="badge" data-tone="${e.type === "Warning" ? "warning" : "neutral"}">${escapeHtml(e.type)}</span><time>${fmtAge(e.ageSeconds)} ago</time></div>
                <div class="timeline__desc">${escapeHtml(e.message)}</div>
              </div>
            </div>`
          ).join("")
        }
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">${snapshot.events?.length || 0} events in the last 24h</span>
        <button class="panel__link" data-action="open-events">Inspect events ${icon("arrow-right")}</button>
      </div>
    </section>

    <section class="panel span-5">
      <div class="panel__head">
        <div class="panel__title">${icon("layers")} Namespace topology</div>
        <span class="panel__sub">${snapshot.namespaces?.length || 0} namespaces</span>
      </div>
      <div class="panel__body namespace-list">
        ${(snapshot.namespaces || [])
          .map((ns) => {
            const total = Math.max(1, ns.pods);
            return `<div class="namespace-row">
              <span class="namespace-row__name">${escapeHtml(ns.name)}</span>
              <span class="namespace-row__bar">
                <i data-tone="healthy" style="width:${(ns.healthy / total) * 100}%"></i>
                <i data-tone="warning" style="width:${(ns.warning / total) * 100}%"></i>
                <i data-tone="failed" style="width:${(ns.failed / total) * 100}%"></i>
              </span>
              <span class="namespace-row__count">${ns.pods} pods</span>
            </div>`;
          })
          .join("")}
      </div>
      <div class="panel__foot row row--between">
        <span class="chart-legend__item"><i class="chart-legend__swatch"></i> healthy</span>
        <span class="chart-legend__item"><i class="chart-legend__swatch" data-tone="amber"></i> degraded</span>
        <span class="chart-legend__item"><i class="chart-legend__swatch" data-tone="violet"></i> failed</span>
      </div>
    </section>
  </div>`;
}
