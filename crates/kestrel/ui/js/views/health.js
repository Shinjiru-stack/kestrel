/* Cluster health: a weighted score over measured signals, plus the utilization
   story behind it - windowed heatmap, sustained bands, and a node ledger.
   Every number comes from the snapshot or the recorded sample history; when a
   signal is missing the score says so instead of guessing. */

import { icon } from "../icons.js";
import { escapeHtml, fmtBytes, fmtCpu, pct } from "../format.js";
import { pulseChart, ring, sparkline, utilizationHeatmap } from "../components/charts.js";

const RANGES = [
  { id: "15m", label: "15m", ms: 15 * 60 * 1000 },
  { id: "1h", label: "1h", ms: 60 * 60 * 1000 },
  { id: "6h", label: "6h", ms: 6 * 60 * 60 * 1000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
];

/* Sustained bands. "Hot" marks a single sample over the pressure line;
   "over" requires the window average to sit above the comfort band. */
const OVER_CPU = 0.75;
const OVER_MEM = 0.8;
const UNDER_CPU = 0.3;
const UNDER_MEM = 0.45;
const HOT_CPU = 0.85;
const HOT_MEM = 0.9;

const BAND_LABEL = { over: "overutilized", under: "underutilized", balanced: "balanced", unknown: "no metrics" };
const BAND_TONE = { over: "critical", under: "info", balanced: "success", unknown: "neutral" };
const BAND_RANK = { over: 0, unknown: 1, balanced: 2, under: 3 };
const POD_WEIGHT = { healthy: 1, warning: 0.6, pending: 0.45, unknown: 0.5, failed: 0 };

function rangeFor(id) {
  return RANGES.find((range) => range.id === id) || RANGES[1];
}

function isNum(value) {
  return value != null && Number.isFinite(Number(value));
}

function average(values) {
  const numbers = values.filter(isNum).map(Number);
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function peak(values) {
  const numbers = values.filter(isNum).map(Number);
  if (!numbers.length) return null;
  return Math.max(...numbers);
}

function shareAbove(values, threshold) {
  const numbers = values.filter(isNum).map(Number);
  if (!numbers.length) return null;
  return numbers.filter((value) => value >= threshold).length / numbers.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function downsample(points, max = 200) {
  if (points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]);
  return out;
}

function toneForScore(score) {
  if (score >= 88) return "success";
  if (score >= 70) return "warning";
  return "critical";
}

function verdictForScore(score) {
  if (score >= 88) return "steady";
  if (score >= 70) return "watchful";
  if (score >= 50) return "strained";
  return "critical";
}

function colorForScore(score) {
  if (score >= 88) return "var(--mint)";
  if (score >= 70) return "var(--amber)";
  return "var(--coral)";
}

function formatPct(value) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function formatPointTime(t, rangeId) {
  const date = new Date(Number(t));
  if (Number.isNaN(date.getTime())) return "";
  if (rangeId === "6h" || rangeId === "24h") {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function shortName(name) {
  return name.length > 18 ? `${name.slice(0, 16)}…` : name;
}

function eventTime(event) {
  const seen = Date.parse(event.lastSeen || "");
  if (!Number.isNaN(seen)) return seen;
  return Date.now() - (Number(event.ageSeconds) || 0) * 1000;
}

export function bandFor(cpu, memory) {
  if (cpu == null && memory == null) return "unknown";
  const c = cpu == null ? null : cpu * 100;
  const m = memory == null ? null : memory * 100;
  if ((c ?? 0) >= OVER_CPU * 100 || (m ?? 0) >= OVER_MEM * 100) return "over";
  if ((c ?? 100) <= UNDER_CPU * 100 && (m ?? 100) <= UNDER_MEM * 100) return "under";
  return "balanced";
}

function buildFactors({ nodes, pods, events, windowPoints, cutoff, rows }) {
  const factors = [];

  if (nodes.length) {
    const ready = nodes.filter((node) => node.status === "Ready").length;
    factors.push({
      id: "ready",
      label: "Node readiness",
      weight: 18,
      value: pct(ready, nodes.length),
      detail: `${ready} of ${nodes.length} ready`,
    });
  }

  if (pods.length) {
    const weighted = pods.reduce((sum, pod) => sum + (POD_WEIGHT[pod.health] ?? 0.5), 0);
    const healthy = pods.filter((pod) => pod.health === "healthy").length;
    factors.push({
      id: "pods",
      label: "Pod health",
      weight: 20,
      value: clamp((weighted / pods.length) * 100, 0, 100),
      detail: `${healthy} of ${pods.length} healthy`,
    });
  }

  const cpuValues = windowPoints.map((point) => point.cpu).filter(isNum);
  const memValues = windowPoints.map((point) => point.memory).filter(isNum);
  const avgCpu = average(cpuValues);
  const avgMem = average(memValues);

  if (avgCpu != null) {
    factors.push({
      id: "cpu",
      label: "CPU headroom",
      weight: 16,
      value: clamp(100 - Math.max(0, avgCpu * 100 - 55) * 2.4, 0, 100),
      detail: `${Math.round(avgCpu * 100)}% average`,
    });
  }
  if (avgMem != null) {
    factors.push({
      id: "memory",
      label: "Memory headroom",
      weight: 16,
      value: clamp(100 - Math.max(0, avgMem * 100 - 60) * 2.5, 0, 100),
      detail: `${Math.round(avgMem * 100)}% average`,
    });
  }

  if (rows.length) {
    const overCount = rows.filter((row) => row.band === "over").length;
    const underCount = rows.filter((row) => row.band === "under").length;
    factors.push({
      id: "balance",
      label: "Fleet balance",
      weight: 10,
      value: clamp(100 - overCount * 35 - underCount * 10, 0, 100),
      detail: `${overCount} over · ${underCount} under`,
    });
  }

  if (nodes.length) {
    const pressure = nodes.filter((node) =>
      (node.conditions || []).some((condition) => condition.type.endsWith("Pressure") && condition.status === "True")
    ).length;
    factors.push({
      id: "pressure",
      label: "Pressure conditions",
      weight: 10,
      value: clamp(100 - pressure * 22, 0, 100),
      detail: pressure ? `${pressure} active` : "none active",
    });
  }

  if (pods.length) {
    const restarts = pods.reduce((sum, pod) => sum + (Number(pod.restarts) || 0), 0);
    const affected = pods.filter((pod) => (Number(pod.restarts) || 0) > 3).length;
    factors.push({
      id: "restarts",
      label: "Restart churn",
      weight: 5,
      value: clamp(100 - (affected / pods.length) * 160 - Math.min(20, restarts * 0.8), 0, 100),
      detail: `${restarts} restarts · ${affected} pods`,
    });
  }

  if (Array.isArray(events) && events.length) {
    const warnings = events.filter((event) => event.type === "Warning" && eventTime(event) >= cutoff).length;
    factors.push({
      id: "events",
      label: "Warning events",
      weight: 5,
      value: clamp(100 - warnings * 6, 0, 100),
      detail: warnings ? `${warnings} in window` : "none in window",
    });
  }

  return factors;
}

function scoreFactorRow(factor) {
  const tone = factor.value >= 80 ? "success" : factor.value >= 55 ? "warning" : "critical";
  return `<div class="health-factor" data-tone="${tone}">
    <div class="health-factor__head">
      <span>${escapeHtml(factor.label)}</span>
      <strong>${Math.round(factor.value)}</strong>
    </div>
    <div class="health-factor__bar"><i style="width:${clamp(factor.value, 0, 100)}%"></i></div>
    <div class="health-factor__detail"><span>${escapeHtml(factor.detail)}</span><span>${factor.weight}% of score</span></div>
  </div>`;
}

function ledgerRow(row) {
  return `<div class="health-ledger__row" data-band="${row.band}">
    <span class="health-dot" data-band="${row.band}"></span>
    <div class="health-ledger__text">
      <strong title="${escapeHtml(row.name)}">${escapeHtml(shortName(row.name))}</strong>
      <span>CPU ${formatPct(row.avgCpu == null ? null : row.avgCpu * 100)} · mem ${formatPct(row.avgMem == null ? null : row.avgMem * 100)}</span>
    </div>
    <span class="health-ledger__meta">${row.hotShare == null ? "—" : `${Math.round(row.hotShare * 100)}% hot`}</span>
    <button class="btn btn--sm btn--ghost btn--icon" data-action="node-pods" data-node="${escapeHtml(row.name)}" title="Show pods on ${escapeHtml(row.name)}">${icon("arrow-right")}</button>
  </div>`;
}

function nodeRow(row, metric) {
  const trend = row.trend;
  const trendColor =
    row.band === "over" ? "var(--coral)" : row.band === "under" ? "var(--cyan)" : "var(--mint)";
  const cpuTone = row.avgCpu != null && row.avgCpu >= OVER_CPU ? "critical" : row.avgCpu != null && row.avgCpu >= 0.6 ? "warning" : "";
  const memTone = row.avgMem != null && row.avgMem >= OVER_MEM ? "critical" : row.avgMem != null && row.avgMem >= 0.6 ? "warning" : "cyan";
  return `<div class="health-node-row" data-band="${row.band}">
    <div class="health-node-row__identity">
      <span class="health-dot" data-band="${row.band}"></span>
      <div class="health-node-row__text">
        <strong title="${escapeHtml(row.name)}">${escapeHtml(shortName(row.name))}</strong>
        <span>${escapeHtml(row.role)} · ${row.pods}/${row.podCapacity} pods</span>
      </div>
    </div>
    <span class="badge health-node-row__band" data-tone="${BAND_TONE[row.band]}">${BAND_LABEL[row.band]}</span>
    <div class="health-node-row__metric">
      <strong>${formatPct(row.avgCpu == null ? null : row.avgCpu * 100)}</strong>
      <div class="health-bar"><i data-tone="${cpuTone}" style="width:${clamp((row.avgCpu ?? 0) * 100, 0, 100)}%"></i></div>
      <span>peak ${formatPct(row.peakCpu == null ? null : row.peakCpu * 100)}</span>
    </div>
    <div class="health-node-row__metric">
      <strong>${formatPct(row.avgMem == null ? null : row.avgMem * 100)}</strong>
      <div class="health-bar"><i data-tone="${memTone}" style="width:${clamp((row.avgMem ?? 0) * 100, 0, 100)}%"></i></div>
      <span>peak ${formatPct(row.peakMem == null ? null : row.peakMem * 100)}</span>
    </div>
    <div class="health-node-row__hot">
      <strong>${row.hotShare == null ? "—" : `${Math.round(row.hotShare * 100)}%`}</strong>
      <span>${metric === "memory" ? "≥90% mem" : "≥85% cpu"}</span>
    </div>
    <div class="health-node-row__trend">
      ${trend.length > 1 ? sparkline(trend, { width: 90, height: 24, color: trendColor, fill: true }) : `<span class="faint">—</span>`}
    </div>
    <button class="btn btn--sm btn--ghost btn--icon health-node-row__action" data-action="node-pods" data-node="${escapeHtml(row.name)}" title="Show pods on ${escapeHtml(row.name)}">${icon("arrow-right")}</button>
  </div>`;
}

function signalRow({ iconName, label, value, detail, tone }) {
  return `<div class="health-signal">
    <span class="health-signal__icon" data-tone="${tone}">${icon(iconName)}</span>
    <div class="health-signal__text">
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(detail)}</small>
    </div>
    <strong>${escapeHtml(value)}</strong>
  </div>`;
}

export function renderHealth(state) {
  const snapshot = state.snapshot;
  if (!snapshot) return "";
  const nodes = snapshot.nodes || [];
  const pods = snapshot.pods || [];
  const events = snapshot.events || [];
  const range = rangeFor(state.healthRange);
  const metric = state.healthMetric === "memory" ? "memory" : "cpu";
  const metricLabel = metric === "memory" ? "memory" : "CPU";
  const now = Date.now();
  const cutoff = now - range.ms;

  const sourceHistory = state.history?.length ? state.history : snapshot.history || [];
  const windowPoints = downsample(
    sourceHistory.filter((point) => Number(point.t) >= cutoff && Number(point.t) <= now + 60_000),
    200
  );
  const nodeHistory = state.nodeHistory && Object.keys(state.nodeHistory).length
    ? state.nodeHistory
    : snapshot.nodeHistory || {};

  const cpuValues = windowPoints.map((point) => point.cpu);
  const memValues = windowPoints.map((point) => point.memory);
  const avgCpu = average(cpuValues);
  const avgMem = average(memValues);
  const peakCpu = peak(cpuValues);
  const peakMem = peak(memValues);
  const hotCpu = shareAbove(cpuValues, 0.8);
  const hotMem = shareAbove(memValues, 0.8);
  const metricsKnown = cpuValues.some(isNum) || memValues.some(isNum);
  const metricsPartial = nodes.some((node) => node.cpuUsage == null || node.memoryUsage == null) || !metricsKnown;

  const rows = nodes.map((node) => {
    const samples = (nodeHistory[node.name] || []).filter(
      (point) => Number(point.t) >= cutoff && Number(point.t) <= now
    );
    const sampleCpu = samples.map((point) => point.cpu);
    const sampleMem = samples.map((point) => point.memory);
    const currentCpu = node.cpuUsage == null ? null : pct(node.cpuUsage, node.cpuCores || 1) / 100;
    const currentMem = node.memoryUsage == null ? null : pct(node.memoryUsage, node.memoryBytes || 1) / 100;
    const avgCpuNode = average(sampleCpu) ?? currentCpu;
    const avgMemNode = average(sampleMem) ?? currentMem;
    const hotShare = samples.length
      ? samples.filter((point) => (isNum(point.cpu) && Number(point.cpu) >= HOT_CPU) || (isNum(point.memory) && Number(point.memory) >= HOT_MEM)).length / samples.length
      : null;
    return {
      name: node.name,
      role: node.roles?.some((role) => role.includes("control-plane") || role.includes("master"))
        ? "control plane"
        : "worker",
      ready: node.status === "Ready",
      pods: Number(node.pods) || 0,
      podCapacity: Number(node.podCapacity) || 0,
      cpu: node.cpuUsage == null ? null : Number(node.cpuUsage),
      memory: node.memoryUsage == null ? null : Number(node.memoryUsage),
      cpuCores: Number(node.cpuCores) || 0,
      memoryBytes: Number(node.memoryBytes) || 0,
      avgCpu: avgCpuNode,
      avgMem: avgMemNode,
      peakCpu: peak(sampleCpu) ?? currentCpu,
      peakMem: peak(sampleMem) ?? currentMem,
      currentCpu,
      currentMem,
      hotShare,
      measured: samples.length > 0,
      band: bandFor(avgCpuNode, avgMemNode),
      trend: sampleCpu.filter(isNum).map(Number).slice(-90),
      samples,
    };
  });

  const factors = buildFactors({ nodes, pods, events, windowPoints, cutoff, rows });
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const score = totalWeight
    ? Math.round(factors.reduce((sum, factor) => sum + factor.value * factor.weight, 0) / totalWeight)
    : 0;
  const scoreTone = toneForScore(score);
  const verdict = verdictForScore(score);
  const scoreColor = colorForScore(score);
  const measured = factors.length;
  const completenessTone = measured >= 8 ? "success" : measured >= 6 ? "warning" : "critical";

  const sortedRows = rows
    .slice()
    .sort((a, b) => (BAND_RANK[a.band] ?? 9) - (BAND_RANK[b.band] ?? 9) || (b.avgCpu ?? -1) - (a.avgCpu ?? -1));
  const over = sortedRows.filter((row) => row.band === "over");
  const under = sortedRows.filter((row) => row.band === "under");
  const balanced = sortedRows.filter((row) => row.band === "balanced");
  const unknown = sortedRows.filter((row) => row.band === "unknown");

  const readyCount = rows.filter((row) => row.ready).length;
  const pressureNodes = nodes.filter((node) =>
    (node.conditions || []).some((condition) => condition.type.endsWith("Pressure") && condition.status === "True")
  ).length;
  const totalRestarts = pods.reduce((sum, pod) => sum + (Number(pod.restarts) || 0), 0);
  const podIssues = pods.filter((pod) => pod.health && pod.health !== "healthy").length;
  const warnings = events.filter((event) => event.type === "Warning" && eventTime(event) >= cutoff);

  const columns = range.id === "24h" ? 32 : 26;
  const span = Math.max(1, now - cutoff);
  const bucketTimes = Array.from({ length: columns }, (_, index) => cutoff + span * ((index + 0.5) / columns));
  const axisLabels = [0, 1, 2, 3].map((index) =>
    formatPointTime(cutoff + span * (index / 3), range.id)
  );
  const heatRows = sortedRows.map((row) => {
    const sums = Array(columns).fill(0);
    const counts = Array(columns).fill(0);
    for (const sample of row.samples) {
      const value = sample?.[metric];
      if (!isNum(value)) continue;
      const index = clamp(Math.floor(((Number(sample.t) - cutoff) / span) * columns), 0, columns - 1);
      sums[index] += Number(value);
      counts[index] += 1;
    }
    return {
      name: row.name,
      band: row.band,
      ready: row.ready,
      avg: metric === "memory" ? row.avgMem : row.avgCpu,
      values: sums.map((sum, index) => (counts[index] ? sum / counts[index] : null)),
    };
  });
  const heatTimes = bucketTimes;

  const labels = windowPoints.map((point) => point.t);
  const series = [
    { name: "CPU", color: "var(--mint)", values: windowPoints.map((point) => (isNum(point.cpu) ? Number(point.cpu) : null)) },
    { name: "Memory", color: "var(--cyan)", values: windowPoints.map((point) => (isNum(point.memory) ? Number(point.memory) : null)) },
  ];

  const findings = [];
  if (!metricsKnown) {
    findings.push("Metrics-server is not reporting node usage. Health is scored from readiness, pod state, and events only; utilization is withheld.");
  }
  if (over.length) {
    findings.push(`${over.length} node${over.length === 1 ? "" : "s"} averaged above the comfort band for this window. Check requests, limits, and eviction headroom before scheduling more work.`);
  }
  if (under.length) {
    findings.push(`${under.length} node${under.length === 1 ? " is" : "s are"} under 30% CPU and 45% memory. Consolidation is possible, but verify disruption budgets first.`);
  }
  if (pressureNodes) {
    findings.push(`${pressureNodes} pressure condition${pressureNodes === 1 ? " is" : "s are"} active on the fleet.`);
  }
  if (!findings.length) {
    findings.push(`Readiness, pressure, and utilization all sit inside the expected band for the ${range.label} window.`);
  }

  const updated = snapshot.generatedAt ? new Date(snapshot.generatedAt) : null;
  const updatedLabel = updated && !Number.isNaN(updated.getTime())
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(updated)
    : "just now";

  return `<div class="page-head">
    <div class="page-head__main">
      <div class="page-head__eyebrow"><span class="status-dot" data-status="${state.connected ? "connected" : "connecting"}"></span><span class="eyebrow">Observe · scored cluster health</span></div>
      <h1 class="page-title">Cluster <em>health</em></h1>
      <p class="page-desc">A weighted read on readiness, pod state, resource headroom, pressure, and restarts, plus which nodes sustained pressure over the last ${range.label}. Measured ${updatedLabel}.</p>
    </div>
    <div class="page-head__actions">
      <div class="health-range" role="group" aria-label="Health time range">
        ${RANGES.map((item) => `<button class="health-range__btn${item.id === range.id ? " is-active" : ""}" data-action="health-range" data-range="${item.id}">${item.label}</button>`).join("")}
      </div>
      <button class="btn btn--ghost" data-action="refresh">${icon("refresh")} Refresh</button>
      <button class="btn btn--primary" data-action="open-copilot">${icon("sparkles")} Ask Copilot</button>
    </div>
  </div>

  <div class="grid grid--12">
    <section class="panel health-score-panel span-4" data-tone="${scoreTone}">
      <div class="panel__head">
        <div>
          <div class="panel__title">${icon("heart")} Health score</div>
          <div class="panel__sub">${range.label} window · ${measured} of 8 signals measured</div>
        </div>
        <span class="badge" data-tone="${scoreTone}">${verdict}</span>
      </div>
      <div class="panel__body health-score-panel__body">
        <div class="health-score">
          <div class="health-score__ring">
            ${ring(score, { size: 132, stroke: 9, color: scoreColor })}
            <div class="health-score__value"><strong>${score}</strong><span>/100</span></div>
          </div>
          <div class="health-score__caption">
            <strong>${escapeHtml(verdict)}</strong>
            <span>${readyCount}/${rows.length} nodes ready · ${pods.length - podIssues}/${pods.length} pods healthy</span>
          </div>
        </div>
        <div class="health-factors">
          ${factors.map(scoreFactorRow).join("")}
        </div>
      </div>
      <div class="panel__foot row row--between">
        <span class="health-foot-note"><span class="status-dot" data-status="${measured >= 8 ? "connected" : measured >= 6 ? "warning" : "error"}"></span>${metricsKnown ? `${measured} signals` : "metrics withheld"}</span>
        <span class="mono faint">weights sum to 100</span>
      </div>
    </section>

    <section class="panel health-chart-panel span-8">
      <div class="panel__head">
        <div>
          <div class="panel__title">${icon("activity")} Resource envelope</div>
          <div class="panel__sub">${range.label} · ${windowPoints.length} measured sample${windowPoints.length === 1 ? "" : "s"} · pressure line at 80%</div>
        </div>
        <span class="badge" data-tone="${metricsKnown ? (metricsPartial ? "warning" : "success") : "critical"}">${metricsKnown ? (metricsPartial ? "partial metrics" : "live") : "no metrics"}</span>
      </div>
      <div class="panel__body health-chart-panel__body">
        <div class="health-chart">
          ${pulseChart(series, { labels: axisLabels, times: labels, height: 258, threshold: 0.8 })}
          ${
            metricsKnown
              ? ""
              : `<div class="health-chart__empty"><span class="status-dot" data-status="${windowPoints.length ? "warning" : "connecting"}"></span><div><strong>${windowPoints.length ? "No metrics in this window" : "Collecting telemetry"}</strong><small>${windowPoints.length ? "Samples exist but carry no CPU or memory values." : "Wait for the next cluster snapshot."}</small></div></div>`
          }
        </div>
        <div class="health-chart-stats">
          <div class="health-chart-stat"><span>CPU average</span><strong>${formatPct(avgCpu == null ? null : avgCpu * 100)}</strong><small>peak ${formatPct(peakCpu == null ? null : peakCpu * 100)}</small></div>
          <div class="health-chart-stat"><span>Memory average</span><strong>${formatPct(avgMem == null ? null : avgMem * 100)}</strong><small>peak ${formatPct(peakMem == null ? null : peakMem * 100)}</small></div>
          <div class="health-chart-stat"><span>CPU above 80%</span><strong>${formatPct(hotCpu == null ? null : hotCpu * 100)}</strong><small>of measured window</small></div>
          <div class="health-chart-stat"><span>Memory above 80%</span><strong>${formatPct(hotMem == null ? null : hotMem * 100)}</strong><small>of measured window</small></div>
        </div>
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">source ${metricsKnown ? "metrics.k8s.io" : "withheld"} · ${windowPoints.length ? `last sample ${formatPointTime(windowPoints[windowPoints.length - 1].t, range.id)}` : "waiting for samples"}</span>
        <button class="panel__link" data-nav="pulse">Open pulse ${icon("arrow-right")}</button>
      </div>
    </section>
  </div>

  <div class="grid grid--12" style="margin-top:14px">
    <section class="panel health-heat-panel span-8">
      <div class="panel__head">
        <div>
          <div class="panel__title">${icon("layers")} Node utilization over time</div>
          <div class="panel__sub">${range.label} · ${columns} buckets · ${metricLabel} · sorted by pressure</div>
        </div>
        <div class="health-toggle" role="group" aria-label="Heatmap metric">
          ${[
            ["cpu", "CPU"],
            ["memory", "Memory"],
          ]
            .map(([id, label]) => `<button class="health-toggle__btn${metric === id ? " is-active" : ""}" data-action="health-metric" data-metric="${id}">${label}</button>`)
            .join("")}
        </div>
      </div>
      <div class="panel__body health-heat-panel__body">
        ${
          heatRows.some((row) => row.values.some((value) => value != null))
            ? utilizationHeatmap(heatRows, { columns, times: heatTimes, labels: axisLabels, metric })
            : `<div class="health-heat__empty">${icon("alert")}<div><strong>No utilization samples</strong><span>Metrics-server is not reporting ${metricLabel.toLowerCase()} usage, so the heatmap is withheld.</span></div></div>`
        }
        <div class="health-legend">
          <span><i style="background:color-mix(in srgb, var(--cyan) 46%, transparent)"></i>under 35%</span>
          <span><i style="background:color-mix(in srgb, var(--mint) 52%, transparent)"></i>35–70%</span>
          <span><i style="background:color-mix(in srgb, var(--amber) 62%, transparent)"></i>70–85%</span>
          <span><i style="background:color-mix(in srgb, var(--coral) 72%, transparent)"></i>85%+</span>
          <span><i class="is-empty"></i>no sample</span>
        </div>
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">each cell averages samples that landed in that bucket</span>
        <button class="panel__link" data-nav="nodes">Node detail ${icon("arrow-right")}</button>
      </div>
    </section>

    <section class="panel health-ledger-panel span-4">
      <div class="panel__head">
        <div>
          <div class="panel__title">${icon("bolt")} Utilization ledger</div>
          <div class="panel__sub">sustained bands over ${range.label}</div>
        </div>
        <span class="badge" data-tone="${over.length ? "critical" : under.length ? "info" : "success"}">${over.length ? `${over.length} over` : under.length ? `${under.length} under` : "even"}</span>
      </div>
      <div class="health-ledger">
        <div class="health-ledger__group">
          <div class="health-ledger__head"><span>Overutilized</span><b>${over.length}</b></div>
          ${over.length ? over.map((row) => ledgerRow(row)).join("") : `<div class="health-ledger__empty">No node sustained above ${Math.round(OVER_CPU * 100)}% CPU or ${Math.round(OVER_MEM * 100)}% memory.</div>`}
        </div>
        <div class="health-ledger__group">
          <div class="health-ledger__head"><span>Underutilized</span><b>${under.length}</b></div>
          ${under.length ? under.map((row) => ledgerRow(row)).join("") : `<div class="health-ledger__empty">No node stayed under ${Math.round(UNDER_CPU * 100)}% CPU and ${Math.round(UNDER_MEM * 100)}% memory.</div>`}
        </div>
        <div class="health-ledger__foot">
          <span>${balanced.length} balanced</span>
          <span>${unknown.length} without metrics</span>
        </div>
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">over ≥${Math.round(OVER_CPU * 100)}% cpu / ≥${Math.round(OVER_MEM * 100)}% mem</span>
        <span class="mono faint">under ≤${Math.round(UNDER_CPU * 100)}% / ≤${Math.round(UNDER_MEM * 100)}%</span>
      </div>
    </section>
  </div>

  <div class="grid grid--12" style="margin-top:14px">
    <section class="panel health-fleet-panel span-8">
      <div class="panel__head">
        <div>
          <div class="panel__title">${icon("server")} Node ledger</div>
          <div class="panel__sub">window averages · sorted by band</div>
        </div>
        <div class="health-chips">
          <span class="pulse-chip" data-tone="critical">${over.length} over</span>
          <span class="pulse-chip" data-tone="info">${under.length} under</span>
          <span class="pulse-chip" data-tone="success">${balanced.length} balanced</span>
        </div>
      </div>
      <div class="health-fleet">
        <div class="health-fleet__head">
          <span>Node</span><span>Band</span><span>CPU avg</span><span>Memory avg</span><span>Hot time</span><span>Trend</span><span></span>
        </div>
        ${rows.length ? sortedRows.map((row) => nodeRow(row, metric)).join("") : `<div class="health-empty">${icon("server")}<div><strong>No nodes reported</strong><span>The snapshot returned no node objects.</span></div></div>`}
      </div>
      <div class="health-fleet-insight">
        <div><span>CPU headroom</span><strong>${nodes.some((node) => node.cpuUsage != null) ? `${fmtCpu(nodes.reduce((sum, node) => sum + Math.max(0, (Number(node.cpuCores) || 0) - (Number(node.cpuUsage) || 0)), 0))} cores` : "—"}</strong></div>
        <div><span>Memory headroom</span><strong>${nodes.some((node) => node.memoryUsage != null) ? fmtBytes(nodes.reduce((sum, node) => sum + Math.max(0, (Number(node.memoryBytes) || 0) - (Number(node.memoryUsage) || 0)), 0)) : "—"}</strong></div>
        <div><span>Pod slots free</span><strong>${rows.reduce((sum, row) => sum + Math.max(0, row.podCapacity - row.pods), 0) || "—"}</strong></div>
        <div><span>Pressure conditions</span><strong>${pressureNodes}</strong></div>
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">${rows.filter((row) => row.measured).length}/${rows.length} nodes with windowed samples · hot time = share of samples at ≥${Math.round(HOT_CPU * 100)}% CPU or ≥${Math.round(HOT_MEM * 100)}% memory</span>
        <button class="panel__link" data-nav="nodes">Full node view ${icon("arrow-right")}</button>
      </div>
    </section>

    <section class="panel health-signals-panel span-4">
      <div class="panel__head">
        <div>
          <div class="panel__title">${icon("shield-check")} Signals</div>
          <div class="panel__sub">the inputs behind the score</div>
        </div>
        <span class="badge" data-tone="${completenessTone}">${measured}/8</span>
      </div>
      <div class="health-signals">
        ${signalRow({ iconName: "server", label: "Nodes ready", value: `${readyCount}/${rows.length}`, detail: `${rows.length - readyCount} unavailable`, tone: readyCount === rows.length ? "success" : "critical" })}
        ${signalRow({ iconName: "alert", label: "Pressure conditions", value: String(pressureNodes), detail: pressureNodes ? "kubelet pressure active" : "no memory, disk, or PID pressure", tone: pressureNodes ? "warning" : "success" })}
        ${signalRow({ iconName: "restart", label: "Restart churn", value: String(totalRestarts), detail: `${pods.filter((pod) => (Number(pod.restarts) || 0) > 3).length} pods above 3 restarts`, tone: totalRestarts > 10 ? "warning" : "success" })}
        ${signalRow({ iconName: "logs", label: "Warning events", value: String(warnings.length), detail: `within ${range.label}`, tone: warnings.length ? "warning" : "success" })}
        ${signalRow({ iconName: "cube", label: "Pod health", value: `${pods.length - podIssues}/${pods.length}`, detail: podIssues ? `${podIssues} need attention` : "all pods healthy", tone: podIssues ? "warning" : "success" })}
        ${signalRow({ iconName: "cpu", label: "Metrics source", value: metricsKnown ? "live" : "none", detail: metricsKnown ? (metricsPartial ? "some nodes without usage" : "metrics.k8s.io reporting") : "install metrics-server to score utilization", tone: metricsKnown ? (metricsPartial ? "warning" : "success") : "critical" })}
      </div>
      <div class="health-findings">
        <div class="health-findings__title">${icon("sparkles")} What stands out</div>
        ${findings.map((finding) => `<p>${escapeHtml(finding)}</p>`).join("")}
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">deterministic · no model calls</span>
        <button class="panel__link" data-nav="copilot">Ask Copilot ${icon("arrow-right")}</button>
      </div>
    </section>
  </div>`;
}
