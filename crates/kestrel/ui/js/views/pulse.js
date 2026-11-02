import { icon } from "../icons.js";
import { escapeHtml, fmtBytes, fmtCpu, pct } from "../format.js";
import { pulseChart, ring, sparkline, utilizationScatter } from "../components/charts.js";

const RANGES = [
  { id: "15m", label: "15m", ms: 15 * 60 * 1000 },
  { id: "1h", label: "1h", ms: 60 * 60 * 1000 },
  { id: "6h", label: "6h", ms: 6 * 60 * 60 * 1000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
];

const STATE_LABEL = {
  idle: "underused",
  balanced: "balanced",
  hot: "hot",
  saturated: "saturated",
  unknown: "no metrics",
};

const STATE_TONE = {
  idle: "info",
  balanced: "success",
  hot: "warning",
  saturated: "critical",
  unknown: "neutral",
};

const STATE_RANK = { saturated: 0, hot: 1, balanced: 2, idle: 3, unknown: 4 };

function rangeFor(id) {
  return RANGES.find((range) => range.id === id) || RANGES[1];
}

function downsample(points, max = 160) {
  if (points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]);
  return out;
}

function average(values) {
  const numbers = values
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number);
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function peak(values) {
  const numbers = values
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number);
  if (!numbers.length) return null;
  return Math.max(...numbers);
}

function usageFor(node) {
  const cpu = node.cpuUsage == null ? null : Number(node.cpuUsage);
  const memory = node.memoryUsage == null ? null : Number(node.memoryUsage);
  const cpuCores = Number(node.cpuCores) || 0;
  const memoryBytes = Number(node.memoryBytes) || 0;
  return {
    cpu,
    memory,
    cpuCores,
    memoryBytes,
    cpuPct: cpu == null ? null : pct(cpu, cpuCores || 1),
    memPct: memory == null ? null : pct(memory, memoryBytes || 1),
    podPct: pct(Number(node.pods) || 0, Number(node.podCapacity) || 1),
  };
}

function nodeState(cpuPct, memPct) {
  if (cpuPct == null && memPct == null) return "unknown";
  const cpu = cpuPct ?? 0;
  const mem = memPct ?? 0;
  if (cpu >= 85 || mem >= 90) return "saturated";
  if (cpu >= 70 || mem >= 80) return "hot";
  if ((cpuPct ?? 100) <= 30 && (memPct ?? 100) <= 45) return "idle";
  return "balanced";
}

function formatPct(value) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function formatPointTime(t, rangeId) {
  const date = new Date(Number(t));
  if (Number.isNaN(date.getTime())) return "";
  if (rangeId === "6h" || rangeId === "24h") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function shortNodeName(name) {
  return name.length > 15 ? `${name.slice(0, 13)}…` : name;
}

function nodeRow(row, nodeHistory) {
  const tone = STATE_TONE[row.state] || "neutral";
  const cpuWidth = row.cpuPct == null ? 0 : Math.max(2, row.cpuPct);
  const memWidth = row.memPct == null ? 0 : Math.max(2, row.memPct);
  const podWidth = row.podPct == null ? 0 : Math.max(2, row.podPct);
  const trend = (nodeHistory[row.name] || [])
    .map((point) => point.cpu)
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .slice(-80);
  const trendColor =
    row.state === "saturated"
      ? "var(--coral)"
      : row.state === "hot"
        ? "var(--amber)"
        : row.state === "idle"
          ? "var(--cyan)"
          : "var(--mint)";

  return `<div class="pulse-node-row" data-state="${row.state}">
    <div class="pulse-node-row__identity">
      <span class="health-dot" data-health="${row.ready ? "healthy" : "failed"}"></span>
      <div class="pulse-node-row__text">
        <strong title="${escapeHtml(row.name)}">${escapeHtml(shortNodeName(row.name))}</strong>
        <span>${escapeHtml(row.role)} · ${row.pods}/${row.podCapacity} pods</span>
      </div>
    </div>
    <div class="pulse-cell">
      <div class="pulse-cell__line"><strong>${formatPct(row.cpuPct)}</strong><span>${row.cpu == null ? "—" : `${fmtCpu(row.cpu)} / ${fmtCpu(row.cpuCores)}`}</span></div>
      <div class="pulse-bar"><i data-tone="${tone}" style="width:${cpuWidth}%"></i></div>
    </div>
    <div class="pulse-cell">
      <div class="pulse-cell__line"><strong>${formatPct(row.memPct)}</strong><span>${row.memory == null ? "—" : `${fmtBytes(row.memory)} / ${fmtBytes(row.memoryBytes)}`}</span></div>
      <div class="pulse-bar"><i data-tone="${tone === "success" ? "info" : tone}" style="width:${memWidth}%"></i></div>
    </div>
    <div class="pulse-cell pulse-cell--pods">
      <div class="pulse-cell__line"><strong>${row.pods}</strong><span>/${row.podCapacity}</span></div>
      <div class="pulse-bar"><i data-tone="${row.podPct > 85 ? "warning" : "info"}" style="width:${podWidth}%"></i></div>
    </div>
    <div class="pulse-node-row__trend">
      ${trend.length > 1 ? sparkline(trend, { width: 92, height: 26, color: trendColor, fill: true }) : `<span class="faint">—</span>`}
    </div>
    <span class="badge pulse-node-row__state" data-tone="${tone}">${STATE_LABEL[row.state]}</span>
    <button class="btn btn--sm btn--ghost btn--icon pulse-node-row__action" data-action="node-pods" data-node="${escapeHtml(row.name)}" title="Show pods on ${escapeHtml(row.name)}">${icon("arrow-right")}</button>
  </div>`;
}

function workloadRow(pod, maxCpu) {
  const cpu = pod.cpuUsage == null ? null : Number(pod.cpuUsage);
  const memory = pod.memoryUsage == null ? null : Number(pod.memoryUsage);
  const width = cpu == null || !maxCpu ? 0 : Math.max(4, (cpu / maxCpu) * 100);
  return `<div class="pulse-workload-row" data-action="open-pod" data-namespace="${escapeHtml(pod.namespace)}" data-name="${escapeHtml(pod.name)}" data-tab="overview" role="button" tabindex="0">
    <span class="health-dot" data-health="${escapeHtml(pod.health || "unknown")}"></span>
    <div class="pulse-workload-row__text">
      <strong title="${escapeHtml(pod.name)}">${escapeHtml(pod.name)}</strong>
      <span>${escapeHtml(pod.namespace)} · ${escapeHtml(pod.node || "unscheduled")}</span>
    </div>
    <div class="pulse-workload-row__values">
      <span>${cpu == null ? "—" : fmtCpu(cpu)}</span>
      <span>${memory == null ? "—" : fmtBytes(memory)}</span>
    </div>
    <div class="pulse-workload-row__bar"><i style="width:${width}%"></i></div>
  </div>`;
}

function metricSeries(points, metric) {
  const cpu = points.map((point) => (point.cpu == null ? null : Number(point.cpu)));
  const memory = points.map((point) => (point.memory == null ? null : Number(point.memory)));
  if (metric === "cpu") return [{ name: "CPU", color: "var(--mint)", values: cpu }];
  if (metric === "memory") return [{ name: "Memory", color: "var(--cyan)", values: memory }];
  return [
    { name: "CPU", color: "var(--mint)", values: cpu },
    { name: "Memory", color: "var(--cyan)", values: memory },
  ];
}

function chartLabels(points, rangeId) {
  if (!points.length) return [];
  const count = Math.min(6, points.length);
  return Array.from({ length: count }, (_, index) => {
    const point = points[Math.round((index / Math.max(1, count - 1)) * (points.length - 1))];
    return formatPointTime(point.t, rangeId);
  });
}

export function renderPulse(state) {
  const snapshot = state.snapshot;
  if (!snapshot) return "";
  const nodes = snapshot.nodes || [];
  const range = rangeFor(state.pulseRange);
  const rows = nodes
    .map((node) => {
      const usage = usageFor(node);
      const stateName = nodeState(usage.cpuPct, usage.memPct);
      return {
        name: node.name,
        ready: node.status === "Ready",
        role: node.roles?.some((role) => role.includes("control-plane") || role.includes("master"))
          ? "control plane"
          : "worker",
        pods: Number(node.pods) || 0,
        podCapacity: Number(node.podCapacity) || 0,
        podPct: usage.podPct,
        cpu: usage.cpu,
        memory: usage.memory,
        cpuCores: usage.cpuCores,
        memoryBytes: usage.memoryBytes,
        cpuPct: usage.cpuPct,
        memPct: usage.memPct,
        state: stateName,
      };
    })
    .sort((a, b) => (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9) || (b.cpuPct ?? -1) - (a.cpuPct ?? -1));

  const knownCpuRows = rows.filter((row) => row.cpu != null && row.cpuCores > 0);
  const knownMemRows = rows.filter((row) => row.memory != null && row.memoryBytes > 0);
  const cpuUsed = knownCpuRows.reduce((sum, row) => sum + row.cpu, 0);
  const cpuCapacity = knownCpuRows.reduce((sum, row) => sum + row.cpuCores, 0);
  const memUsed = knownMemRows.reduce((sum, row) => sum + row.memory, 0);
  const memCapacity = knownMemRows.reduce((sum, row) => sum + row.memoryBytes, 0);
  const cpuPct = cpuCapacity ? pct(cpuUsed, cpuCapacity) : null;
  const memPct = memCapacity ? pct(memUsed, memCapacity) : null;
  const metricsKnown = knownCpuRows.length > 0 || knownMemRows.length > 0;
  const metricsPartial = rows.some((row) => row.cpu == null || row.memory == null);
  const metricsTone = metricsKnown ? (metricsPartial ? "warning" : "success") : "critical";
  const metricsLabel = metricsKnown ? (metricsPartial ? "partial metrics" : "metrics.k8s.io") : "metrics unavailable";

  const pressureNodes = nodes.filter((node) =>
    (node.conditions || []).some((condition) => condition.type.endsWith("Pressure") && condition.status === "True")
  ).length;
  const idleCount = rows.filter((row) => row.state === "idle").length;
  const hotCount = rows.filter((row) => row.state === "hot").length;
  const saturatedCount = rows.filter((row) => row.state === "saturated").length;
  const readyCount = rows.filter((row) => row.ready).length;
  const totalPods = rows.reduce((sum, row) => sum + row.pods, 0);
  const totalPodCapacity = rows.reduce((sum, row) => sum + row.podCapacity, 0);
  const podSlotPct = totalPodCapacity ? pct(totalPods, totalPodCapacity) : null;
  const cpuPcts = rows.map((row) => row.cpuPct).filter((value) => value != null);
  const spread = cpuPcts.length > 1 ? Math.max(...cpuPcts) - Math.min(...cpuPcts) : 0;
  const balanceScore = cpuPcts.length
    ? Math.max(0, Math.min(100, Math.round(100 - spread * 0.9 - pressureNodes * 6)))
    : null;
  const balanceTone = balanceScore == null ? "neutral" : balanceScore >= 78 ? "success" : balanceScore >= 55 ? "warning" : "critical";
  const balanceLabel = balanceScore == null ? "unknown" : balanceScore >= 78 ? "even" : balanceScore >= 55 ? "workable" : "skewed";
  const balanceColor = balanceTone === "success" ? "var(--mint)" : balanceTone === "warning" ? "var(--amber)" : balanceTone === "critical" ? "var(--coral)" : "var(--text-faint)";

  const sourceHistory = state.history?.length ? state.history : snapshot.history || [];
  const cutoff = Date.now() - range.ms;
  const windowPoints = downsample(
    sourceHistory.filter((point) => Number(point.t) >= cutoff && Number(point.t) <= Date.now() + 60_000),
    160
  );
  const cpuValues = windowPoints.map((point) => (point.cpu == null ? null : Number(point.cpu)));
  const memValues = windowPoints.map((point) => (point.memory == null ? null : Number(point.memory)));
  const avgCpu = average(cpuValues);
  const avgMem = average(memValues);
  const peakCpu = peak(cpuValues);
  const peakMem = peak(memValues);
  const labels = chartLabels(windowPoints, range.id);
  const series = metricSeries(windowPoints, state.pulseMetric);
  const chartSeries = series.filter((item) => item.values.some((value) => value != null));
  const nodeHistory = state.nodeHistory && Object.keys(state.nodeHistory).length ? state.nodeHistory : snapshot.nodeHistory || {};
  const metricText = state.pulseMetric === "both" ? "CPU + memory" : state.pulseMetric === "cpu" ? "CPU" : "memory";

  const topPods = (snapshot.pods || [])
    .filter((pod) => pod.cpuUsage != null || pod.memoryUsage != null)
    .slice()
    .sort((a, b) => (Number(b.cpuUsage) || 0) - (Number(a.cpuUsage) || 0))
    .slice(0, 6);
  const maxPodCpu = topPods.reduce((max, pod) => Math.max(max, Number(pod.cpuUsage) || 0), 0);
  const recommendedNode = rows.find((row) => row.state === "saturated") || rows.find((row) => row.state === "hot") || rows[0];
  const recommendation = !metricsKnown
    ? "Metrics-server is not reporting node usage. Kestrel shows allocatable capacity only; it does not invent utilization."
    : saturatedCount
      ? `${saturatedCount} node${saturatedCount === 1 ? " is" : "s are"} in the pressure band. Check requests, limits, and eviction headroom before scheduling more work.`
      : hotCount
        ? `${hotCount} node${hotCount === 1 ? " is" : "s are"} above the comfort band. Watch ${recommendedNode?.name || "the fleet"} as the next workload lands.`
        : idleCount
          ? `${idleCount} node${idleCount === 1 ? " is" : "s are"} under 30% CPU. Consolidation is possible, but verify disruption budgets first.`
          : "Load is spread across the fleet. No node is in the pressure band.";

  const cpuSpark = cpuValues.filter((value) => value != null).slice(-48);
  const memSpark = memValues.filter((value) => value != null).slice(-48);
  const updated = snapshot.generatedAt ? new Date(snapshot.generatedAt) : null;
  const updatedLabel = updated && !Number.isNaN(updated.getTime())
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(updated)
    : "just now";

  return `<div class="page-head">
    <div class="page-head__main">
      <div class="page-head__eyebrow"><span class="status-dot" data-status="${state.connected ? "connected" : "connecting"}"></span><span class="eyebrow">Telemetry · capacity and balance</span></div>
      <h1 class="page-title">Cluster <em>pulse</em></h1>
      <p class="page-desc">CPU and memory pressure, node balance, and the workloads setting the pace. Measured ${updatedLabel} · ${snapshot.cluster.latencyMs || 0}ms API latency.</p>
    </div>
    <div class="page-head__actions">
      <button class="btn btn--ghost" data-action="refresh">${icon("refresh")} Refresh</button>
      <button class="btn btn--primary" data-action="open-copilot">${icon("sparkles")} Ask Copilot</button>
    </div>
  </div>

  <div class="pulse-hero">
    <section class="pulse-metric-card" data-tone="mint">
      <div class="pulse-metric-card__head">
        <span class="pulse-metric-card__icon">${icon("cpu")}</span>
        <span class="pulse-metric-card__label">CPU pressure</span>
        <span class="badge" data-tone="${knownCpuRows.length ? "success" : "critical"}">${knownCpuRows.length ? "live" : "no data"}</span>
      </div>
      <div class="pulse-metric-card__value">${cpuPct == null ? "—" : Math.round(cpuPct)}<small>${cpuPct == null ? "" : "%"}</small></div>
      <div class="pulse-meter"><span style="width:${cpuPct ?? 0}%"></span><i class="pulse-meter__mark" style="left:70%"></i><i class="pulse-meter__mark" style="left:85%"></i></div>
      <div class="pulse-metric-card__meta"><span>${fmtCpu(cpuUsed)} / ${fmtCpu(cpuCapacity)} cores</span><span>${fmtCpu(Math.max(0, cpuCapacity - cpuUsed))} free</span></div>
      <div class="pulse-metric-card__spark">${cpuSpark.length > 1 ? sparkline(cpuSpark, { width: 240, height: 34, color: "var(--mint)", fill: true }) : ""}</div>
      <div class="pulse-metric-card__foot"><span>cluster aggregate</span><span>${knownCpuRows.length}/${rows.length} nodes reporting</span></div>
    </section>

    <section class="pulse-metric-card" data-tone="cyan">
      <div class="pulse-metric-card__head">
        <span class="pulse-metric-card__icon">${icon("memory")}</span>
        <span class="pulse-metric-card__label">Memory pressure</span>
        <span class="badge" data-tone="${knownMemRows.length ? "info" : "critical"}">${knownMemRows.length ? "live" : "no data"}</span>
      </div>
      <div class="pulse-metric-card__value">${memPct == null ? "—" : Math.round(memPct)}<small>${memPct == null ? "" : "%"}</small></div>
      <div class="pulse-meter" data-tone="cyan"><span style="width:${memPct ?? 0}%"></span><i class="pulse-meter__mark" style="left:70%"></i><i class="pulse-meter__mark" style="left:85%"></i></div>
      <div class="pulse-metric-card__meta"><span>${fmtBytes(memUsed)} / ${fmtBytes(memCapacity)}</span><span>${fmtBytes(Math.max(0, memCapacity - memUsed))} free</span></div>
      <div class="pulse-metric-card__spark">${memSpark.length > 1 ? sparkline(memSpark, { width: 240, height: 34, color: "var(--cyan)", fill: true }) : ""}</div>
      <div class="pulse-metric-card__foot"><span>allocatable memory</span><span>${knownMemRows.length}/${rows.length} nodes reporting</span></div>
    </section>

    <section class="pulse-balance-card">
      <div class="pulse-balance-card__head">
        <div>
          <span class="pulse-balance-card__eyebrow">${icon("activity")} Load balance</span>
          <h3>${balanceLabel}</h3>
        </div>
        <span class="badge" data-tone="${balanceTone}">${balanceScore == null ? "no metrics" : `${balanceScore}/100`}</span>
      </div>
      <div class="pulse-balance-card__body">
        <div class="pulse-balance-card__ring">
          ${balanceScore == null ? `<span class="pulse-balance-card__empty">—</span>` : ring(balanceScore, { size: 104, stroke: 8, color: balanceColor })}
          <div class="pulse-balance-card__ring-label">${balanceScore == null ? "—" : balanceScore}</div>
        </div>
        <p>${escapeHtml(recommendation)}</p>
      </div>
      <div class="pulse-balance-card__chips">
        <span class="pulse-chip" data-tone="info">${idleCount} underused</span>
        <span class="pulse-chip" data-tone="warning">${hotCount} hot</span>
        <span class="pulse-chip" data-tone="critical">${saturatedCount} saturated</span>
      </div>
      <div class="pulse-balance-card__foot">
        <span class="status-dot" data-status="${metricsKnown ? (metricsPartial ? "warning" : "connected") : "error"}"></span>
        <span>${escapeHtml(metricsLabel)}</span>
        <span class="spacer"></span>
        <span>${pressureNodes} pressure condition${pressureNodes === 1 ? "" : "s"}</span>
      </div>
    </section>
  </div>

  <div class="grid grid--12" style="margin-top:14px">
    <section class="panel pulse-history-panel span-8">
      <div class="panel__head pulse-history-panel__head">
        <div>
          <div class="panel__title">${icon("activity")} Telemetry window</div>
          <div class="panel__sub">${range.label} · ${windowPoints.length} measured sample${windowPoints.length === 1 ? "" : "s"} · ${metricText}</div>
        </div>
        <div class="pulse-controls">
          <div class="pulse-seg" role="group" aria-label="Telemetry time range">
            ${RANGES.map((item) => `<button class="pulse-seg__btn${item.id === range.id ? " is-active" : ""}" data-action="pulse-range" data-range="${item.id}">${item.label}</button>`).join("")}
          </div>
          <div class="pulse-seg pulse-seg--metric" role="group" aria-label="Telemetry metric">
            ${[
              ["both", "Both"],
              ["cpu", "CPU"],
              ["memory", "Memory"],
            ]
              .map(([id, label]) => `<button class="pulse-seg__btn${state.pulseMetric === id ? " is-active" : ""}" data-action="pulse-metric" data-metric="${id}">${label}</button>`)
              .join("")}
          </div>
        </div>
      </div>
      <div class="panel__body pulse-history-panel__body">
        <div class="pulse-chart-wrap">
          ${pulseChart(chartSeries, { labels, times: windowPoints.map((point) => point.t), height: 258, threshold: 0.8 })}
          ${
            chartSeries.length
              ? ""
              : `<div class="pulse-chart__empty"><span class="status-dot" data-status="${windowPoints.length ? "warning" : "connecting"}"></span><div><strong>${windowPoints.length ? "No metrics in this window" : "Collecting telemetry"}</strong><small>${windowPoints.length ? "Metrics-server is not reporting usage for these samples." : "No measured samples in this window yet."}</small></div></div>`
          }
        </div>
        <div class="pulse-chart-stats">
          <div class="pulse-chart-stat"><span>CPU average</span><strong>${formatPct(avgCpu == null ? null : avgCpu * 100)}</strong><small>peak ${formatPct(peakCpu == null ? null : peakCpu * 100)}</small></div>
          <div class="pulse-chart-stat"><span>Memory average</span><strong>${formatPct(avgMem == null ? null : avgMem * 100)}</strong><small>peak ${formatPct(peakMem == null ? null : peakMem * 100)}</small></div>
          <div class="pulse-chart-stat"><span>Pod slots</span><strong>${podSlotPct == null ? "—" : `${Math.round(podSlotPct)}%`}</strong><small>${totalPods} / ${totalPodCapacity || "—"}</small></div>
          <div class="pulse-chart-stat"><span>Nodes ready</span><strong>${readyCount}/${rows.length}</strong><small>${pressureNodes} pressure</small></div>
        </div>
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">source ${escapeHtml(metricsLabel)} · ${windowPoints.length ? `last sample ${formatPointTime(windowPoints[windowPoints.length - 1].t, range.id)}` : "waiting for samples"}</span>
        <button class="panel__link" data-nav="nodes">Open node detail ${icon("arrow-right")}</button>
      </div>
    </section>

    <section class="panel pulse-scatter-panel span-4">
      <div class="panel__head">
        <div>
          <div class="panel__title">${icon("network")} Node balance</div>
          <div class="panel__sub">current CPU vs memory</div>
        </div>
        <span class="badge" data-tone="${readyCount === rows.length && rows.length ? "success" : "warning"}">${readyCount}/${rows.length} ready</span>
      </div>
      <div class="panel__body pulse-scatter-panel__body">
        ${rows.some((row) => row.cpuPct != null && row.memPct != null) ? utilizationScatter(rows, { width: 360, height: 300 }) : `<div class="pulse-empty">${icon("alert")}<strong>No node metrics</strong><span>Metrics-server is not reporting node usage. Capacity remains visible; utilization is withheld.</span></div>`}
        <div class="pulse-legend">
          <span><i style="background:var(--cyan)"></i>underused</span>
          <span><i style="background:var(--mint)"></i>balanced</span>
          <span><i style="background:var(--amber)"></i>hot</span>
          <span><i style="background:var(--coral)"></i>saturated</span>
        </div>
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">bubble size = scheduled pods</span>
        <button class="panel__link" data-nav="nodes">Nodes ${icon("arrow-right")}</button>
      </div>
    </section>
  </div>

  <div class="grid grid--12" style="margin-top:14px">
    <section class="panel pulse-fleet-panel span-8">
      <div class="panel__head">
        <div>
          <div class="panel__title">${icon("server")} Fleet utilization</div>
          <div class="panel__sub">current · sorted by pressure</div>
        </div>
        <div class="pulse-fleet-chips">
          <span class="pulse-chip" data-tone="info">${idleCount} underused</span>
          <span class="pulse-chip" data-tone="warning">${hotCount} hot</span>
          <span class="pulse-chip" data-tone="critical">${saturatedCount} saturated</span>
        </div>
      </div>
      <div class="pulse-fleet">
        <div class="pulse-fleet__head">
          <span>Node</span><span>CPU</span><span>Memory</span><span>Pods</span><span>Trend</span><span>State</span><span></span>
        </div>
        ${rows.length ? rows.map((row) => nodeRow(row, nodeHistory)).join("") : `<div class="pulse-empty">${icon("server")}<strong>No nodes reported</strong><span>The snapshot returned no node objects.</span></div>`}
      </div>
      <div class="pulse-fleet-insight">
        <div><span>CPU headroom</span><strong>${knownCpuRows.length ? `${fmtCpu(Math.max(0, cpuCapacity - cpuUsed))} cores` : "—"}</strong></div>
        <div><span>Memory headroom</span><strong>${knownMemRows.length ? fmtBytes(Math.max(0, memCapacity - memUsed)) : "—"}</strong></div>
        <div><span>Pod slots free</span><strong>${totalPodCapacity ? totalPodCapacity - totalPods : "—"}</strong></div>
        <div><span>Pressure conditions</span><strong>${pressureNodes}</strong></div>
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">underused ≤30% CPU & ≤45% memory · saturated ≥85% CPU or ≥90% memory</span>
        <button class="panel__link" data-nav="nodes">Full node view ${icon("arrow-right")}</button>
      </div>
    </section>

    <section class="panel pulse-workload-panel span-4">
      <div class="panel__head">
        <div>
          <div class="panel__title">${icon("zap")} Top consumers</div>
          <div class="panel__sub">current pod usage</div>
        </div>
        <span class="badge" data-tone="${topPods.length ? "info" : "warning"}">${topPods.length}</span>
      </div>
      <div class="pulse-workload-list">
        ${topPods.length ? topPods.map((pod) => workloadRow(pod, maxPodCpu)).join("") : `<div class="pulse-empty">${icon("alert")}<strong>No pod metrics</strong><span>Metrics-server is not reporting pod usage, so no consumer ranking is shown.</span></div>`}
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">${metricsKnown ? "live pod usage" : "usage withheld"}</span>
        <button class="panel__link" data-action="open-workloads">All workloads ${icon("arrow-right")}</button>
      </div>
    </section>
  </div>`;
}
