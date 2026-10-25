/* Hand-built SVG charts. No chart library, no canvas, no dependency. */

import { clamp, fmtCpu, fmtMemory } from "../format.js";

let chartId = 0;
const nextId = (prefix) => `${prefix}-${++chartId}`;

function points(values, width, height, pad, min = 0, max = 1) {
  const n = values.length;
  const span = Math.max(1, n - 1);
  return values.map((value, i) => {
    const x = pad + (i / span) * (width - pad * 2);
    const y = height - pad - (clamp((value - min) / (max - min), 0, 1) * (height - pad * 2));
    return [x, y];
  });
}

function smoothPath(pts) {
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

export function sparkline(values, options = {}) {
  const width = options.width || 100;
  const height = options.height || 30;
  const pad = options.pad ?? 2;
  const color = options.color || "var(--mint)";
  const fill = options.fill ?? true;
  const strokeWidth = options.strokeWidth || 1.6;
  const id = nextId("spark");
  const source = values.length ? values : [0.4];
  const flat = source.length === 1 ? [source[0], source[0]] : source;
  const pts = points(flat, width, height, pad, options.min ?? 0, options.max ?? 1);
  const line = smoothPath(pts);
  const area = `${line} L ${pts[pts.length - 1][0].toFixed(2)} ${height - pad} L ${pts[0][0].toFixed(2)} ${height - pad} Z`;
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${fill ? `<path d="${area}" fill="url(#${id})"/>` : ""}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function areaChart(series, options = {}) {
  const width = options.width || 900;
  const height = options.height || 220;
  const padX = options.padX ?? 36;
  const padTop = options.padTop ?? 16;
  const padBottom = options.padBottom ?? 24;
  const max = options.max ?? 1;
  const min = options.min ?? 0;
  const gridCount = options.gridCount ?? 4;
  const labels = options.labels || [];
  const warming = Boolean(options.warming);
  const id = nextId("area");
  const plotH = height - padTop - padBottom;
  const plotW = width - padX - 8;

  const mapPoints = (values) => {
    const source = values.length ? values : [min];
    const flat = source.length === 1 ? [source[0], source[0]] : source;
    const n = Math.max(1, flat.length);
    const span = Math.max(1, n - 1);
    return flat.map((value, i) => [
      padX + (i / span) * plotW,
      padTop + (1 - clamp((value - min) / (max - min), 0, 1)) * plotH,
    ]);
  };

  const grid = Array.from({ length: gridCount + 1 }, (_, i) => {
    const y = padTop + (i / gridCount) * plotH;
    return `<line class="chart__grid" x1="${padX}" y1="${y.toFixed(1)}" x2="${width - 8}" y2="${y.toFixed(1)}"/>`;
  }).join("");

  const yLabels = Array.from({ length: gridCount + 1 }, (_, i) => {
    const value = max - (i / gridCount) * (max - min);
    const y = padTop + (i / gridCount) * plotH;
    return `<text class="chart__axis" x="${padX - 8}" y="${y + 3}" text-anchor="end">${Math.round(value * 100)}%</text>`;
  }).join("");

  const xLabels = labels
    .map((label, i) => {
      const x = labels.length === 1 ? width - 8 : padX + (i / Math.max(1, labels.length - 1)) * plotW;
      const anchor = labels.length === 1 ? "end" : i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle";
      return `<text class="chart__axis" x="${x.toFixed(1)}" y="${height - 6}" text-anchor="${anchor}">${label}</text>`;
    })
    .join("");

  const paths = series
    .map((s, idx) => {
      const clean = mapPoints(s.values);
      const line = smoothPath(clean);
      const area = `${line} L ${clean[clean.length - 1][0].toFixed(2)} ${padTop + plotH} L ${clean[0][0].toFixed(2)} ${padTop + plotH} Z`;
      return `<path d="${area}" fill="url(#${id}-${idx})" class="chart__area" style="opacity:.18"/>
        <path d="${line}" class="chart__line" stroke="${s.color || "var(--mint)"}"/>
        <circle class="chart__dot" cx="${clean[clean.length - 1][0].toFixed(2)}" cy="${clean[clean.length - 1][1].toFixed(2)}" r="3.2" fill="${s.color || "var(--mint)"}"/>
        <defs><linearGradient id="${id}-${idx}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${s.color || "var(--mint)"}" stop-opacity=".55"/>
          <stop offset="100%" stop-color="${s.color || "var(--mint)"}" stop-opacity="0"/>
        </linearGradient></defs>`;
    })
    .join("");

  return `<div class="chart ${warming ? "is-warming" : ""}" data-chart="overview">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cluster resource usage over time">
      ${grid}${yLabels}${xLabels}${paths}
      <line class="chart__hover-line" x1="${padX}" y1="${padTop}" x2="${padX}" y2="${padTop + plotH}"/>
    </svg>
    <div class="chart-tooltip"><div class="chart-tooltip__time">now</div><div class="chart-tooltip__row"><span><i></i>CPU</span><b>—</b></div><div class="chart-tooltip__row"><span><i style="background:var(--cyan)"></i>Memory</span><b>—</b></div></div>
  </div>`;
}

export function ring(percent, options = {}) {
  const size = options.size || 144;
  const stroke = options.stroke || 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = clamp(percent, 0, 100);
  const dash = (value / 100) * circumference;
  const color = options.color || "var(--mint)";
  const track = options.track || "var(--line)";
  const id = nextId("ring");
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".55"/>
      <stop offset="100%" stop-color="${color}"/>
    </linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="url(#${id})" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"
      style="filter:drop-shadow(0 0 8px color-mix(in srgb, ${color} 45%, transparent))"/>
  </svg>`;
}

export function nodeRing(percent, options = {}) {
  const size = options.size || 58;
  const stroke = options.stroke || 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = clamp(percent, 0, 100);
  const dash = (value / 100) * circumference;
  const color = options.color || (value > 85 ? "var(--coral)" : value > 70 ? "var(--amber)" : "var(--mint)");
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

export function severityBar(summary) {
  const total = Math.max(1, (summary.critical || 0) + (summary.high || 0) + (summary.medium || 0) + (summary.low || 0) + (summary.unknown || 0));
  const order = ["critical", "high", "medium", "low", "unknown"];
  return `<div class="severity-bar" aria-label="Vulnerability severity distribution">
    ${order
      .filter((k) => summary[k] > 0)
      .map((k) => `<i data-tone="${k}" style="width:${((summary[k] / total) * 100).toFixed(2)}%"></i>`)
      .join("")}
  </div>`;
}

export function metricLabel(kind, value) {
  if (kind === "cpu") return fmtCpu(value);
  if (kind === "memory") return fmtMemory(value);
  return String(value);
}
