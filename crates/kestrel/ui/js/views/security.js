import { icon } from "../icons.js";
import { escapeHtml, fmtNumber, severityTone } from "../format.js";
import { severityBar } from "../components/charts.js";

function reportTotal(report) {
  const s = report.summary || {};
  return (s.critical || 0) + (s.high || 0) + (s.medium || 0) + (s.low || 0) + (s.unknown || 0);
}

function securityStats(reports) {
  const totals = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const r of reports) {
    for (const key of Object.keys(totals)) totals[key] += Number(r.summary?.[key]) || 0;
  }
  const all = Object.values(totals).reduce((a, b) => a + b, 0);
  const score = Math.max(18, Math.min(100, Math.round(100 - totals.critical * 8 - totals.high * 2.4 - totals.medium * 0.5)));
  return { totals, all, score };
}

function filteredReports(state) {
  const sec = state.security || {};
  const q = (sec.search || "").trim().toLowerCase();
  const filter = sec.filter || "all";
  return (sec.reports || [])
    .filter((r) => {
      if (filter === "critical" && !(r.summary?.critical > 0)) return false;
      if (filter === "high" && !(r.summary?.high > 0)) return false;
      if (!q) return true;
      return `${r.name} ${r.namespace} ${r.workload} ${r.container} ${r.kind}`.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const ac = Number(a.summary?.critical) || 0;
      const bc = Number(b.summary?.critical) || 0;
      const ah = Number(a.summary?.high) || 0;
      const bh = Number(b.summary?.high) || 0;
      return bc - ac || bh - ah || reportTotal(b) - reportTotal(a) || a.name.localeCompare(b.name);
    });
}

function vulnCards(totals) {
  const items = [
    ["critical", "Critical", "patch immediately"],
    ["high", "High", "next maintenance window"],
    ["medium", "Medium", "track and schedule"],
    ["low", "Low", "hygiene backlog"],
  ];
  return `<div class="vuln-grid">
    ${items
      .map(
        ([key, label, foot]) => `<div class="vuln-card" data-tone="${key}">
          <div class="vuln-card__label"><i></i>${label}</div>
          <div class="vuln-card__value">${fmtNumber(totals[key])}</div>
          <div class="vuln-card__foot">${foot}</div>
        </div>`
      )
      .join("")}
  </div>`;
}

function hero(state, reports, stats) {
  const scoreTone = stats.score >= 80 ? "var(--mint)" : stats.score >= 55 ? "var(--amber)" : "var(--coral)";
  const images = new Set(reports.map((r) => `${r.namespace}/${r.workload}/${r.container}`)).size;
  const workloads = new Set(reports.map((r) => `${r.namespace}/${r.workload}`)).size;
  return `<div class="security-hero">
    <div class="security-hero__copy">
      <div class="eyebrow" style="margin-bottom:7px">Security posture · live scan</div>
      <h2>${stats.totals.critical ? `${stats.totals.critical} critical vulnerabilities need a decision.` : stats.totals.high ? `${stats.totals.high} high-severity findings are open.` : "The observed images are inside the guardrail."}</h2>
      <p>${reports.length ? `${reports.length} vulnerability reports cover ${workloads} workloads and ${images} running containers. ${stats.totals.critical + stats.totals.high} findings are rated critical or high.` : "No vulnerability reports were returned by the cluster. Install a scanner such as Trivy Operator to populate this view."}</p>
      <div class="security-hero__tags">
        <span class="badge badge--dot" data-tone="success">${images} images observed</span>
        <span class="badge badge--dot" data-tone="critical">${stats.totals.critical} critical</span>
        <span class="badge badge--dot" data-tone="warning">${stats.totals.high} high</span>
        <span class="badge">${fmtNumber(stats.all)} total findings</span>
      </div>
    </div>
    <div class="security-score">
      <div class="security-score__value" style="color:${scoreTone}">${stats.score}</div>
      <div class="security-score__label">exposure score</div>
      <div class="hint" style="text-align:center;margin-top:3px">higher is safer</div>
    </div>
  </div>`;
}

function reportRow(report, selectedName) {
  const selected = selectedName === report.name;
  const total = reportTotal(report);
  return `<div class="report-row${selected ? " is-selected" : ""}" data-action="security-select" data-name="${escapeHtml(report.name)}"${selected ? ' aria-current="true"' : ""}>
    <span class="workload-kind-icon" data-kind="${escapeHtml(report.kind)}">${icon(report.kind === "StatefulSet" ? "database" : report.kind === "DaemonSet" ? "server" : "layers")}</span>
    <div class="report-row__body">
      <div class="report-row__name">${escapeHtml(report.name)}</div>
      <div class="report-row__meta">${escapeHtml(report.namespace)} · ${escapeHtml(report.workload)} · ${escapeHtml(report.container)} · ${total} findings</div>
    </div>
    <div class="report-row__counts">
      ${report.summary?.critical ? `<span class="badge" data-tone="critical">${report.summary.critical}</span>` : ""}
      ${report.summary?.high ? `<span class="badge" data-tone="warning">${report.summary.high}</span>` : ""}
      ${report.summary?.medium ? `<span class="badge" data-tone="info">${report.summary.medium}</span>` : ""}
    </div>
    <span style="width:82px;display:block">${severityBar(report.summary || {})}</span>
    ${icon("chevron-right")}
  </div>`;
}

function detail(state, report) {
  if (!report) {
    return `<div class="empty" style="min-height:340px">
      <div class="empty__icon">${icon("shield")}</div>
      <div class="empty__title">Select a report</div>
      <div class="empty__desc">Choose an image to see its vulnerability detail and a prioritized upgrade path.</div>
    </div>`;
  }
  const vulns = report.vulnerabilities || [];
  return `<div class="vuln-detail">
    <div class="vuln-detail__head">
      <div class="workload-kind-icon" data-kind="${escapeHtml(report.kind)}">${icon(report.kind === "StatefulSet" ? "database" : "layers")}</div>
      <div style="min-width:0;flex:1">
        <div class="vuln-detail__name">${escapeHtml(report.workload)}</div>
        <div class="vuln-detail__meta">${escapeHtml(report.namespace)} · ${escapeHtml(report.kind)} · ${escapeHtml(report.container)}</div>
      </div>
      <span class="badge badge--dot" data-tone="${report.summary?.critical ? "critical" : report.summary?.high ? "warning" : "success"}">${reportTotal(report)} findings</span>
    </div>
    <div class="vuln-detail__bar">${severityBar(report.summary || {})}</div>
    <div class="vuln-detail__summary">
      <div><span>Critical</span><strong data-tone="critical">${report.summary?.critical || 0}</strong></div>
      <div><span>High</span><strong data-tone="warning">${report.summary?.high || 0}</strong></div>
      <div><span>Medium</span><strong data-tone="info">${report.summary?.medium || 0}</strong></div>
      <div><span>Low</span><strong>${report.summary?.low || 0}</strong></div>
    </div>
    <div class="detail-section__head" style="margin-top:14px">
      <span class="detail-section__title">Findings</span>
      <span class="mono faint">${vulns.length} shown</span>
    </div>
    <div class="vuln-list">
      ${vulns
        .map(
          (v) => `<div class="vuln-row">
            <span class="badge" data-tone="${severityTone(v.severity)}">${escapeHtml(v.severity)}</span>
            <div class="vuln-row__body">
              <div class="vuln-row__title"><span class="mono">${escapeHtml(v.id)}</span> ${escapeHtml(v.title)}</div>
              <div class="vuln-row__meta">${escapeHtml(v.package)} ${escapeHtml(v.version)}${v.fixedVersion ? ` → fixed in ${escapeHtml(v.fixedVersion)}` : " · no fix published"}</div>
            </div>
          </div>`
        )
        .join("") || `<div class="hint">The report contains no individual findings.</div>`}
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn btn--sm btn--primary" data-action="security-ask" data-name="${escapeHtml(report.workload)}">${icon("sparkles")} Ask Copilot to prioritize</button>
      <button class="btn btn--sm btn--ghost" data-action="open-workloads">${icon("layers")} Open workloads</button>
    </div>
  </div>`;
}

export function renderSecurity(state) {
  const sec = state.security || {};
  const reports = sec.reports || [];
  const stats = securityStats(reports);
  const visible = filteredReports(state);
  const selected = visible.find((r) => r.name === sec.selected) || visible[0] || null;
  const filter = sec.filter || "all";
  const search = sec.search || "";

  return `<div class="page-head">
    <div class="page-head__main">
      <div class="page-head__eyebrow"><span class="status-dot" data-status="${state.connected ? "connected" : "connecting"}"></span><span class="eyebrow">Intelligence · image exposure</span></div>
      <h1 class="page-title">Security</h1>
      <p class="page-desc">Vulnerability reports from the cluster's scanner, grouped by workload and image. ${reports.length ? `${reports.length} reports · ${fmtNumber(stats.all)} findings · ${stats.totals.critical + stats.totals.high} critical or high.` : "No reports available yet."}</p>
    </div>
    <div class="page-head__actions">
      <button class="btn btn--ghost" data-action="security-refresh">${icon("refresh")} Re-scan</button>
      <button class="btn btn--primary" data-action="open-copilot">${icon("sparkles")} Ask Copilot</button>
    </div>
  </div>

  ${hero(state, reports, stats)}
  <div style="margin-top:14px">${vulnCards(stats.totals)}</div>

  <div class="grid grid--12" style="margin-top:14px">
    <section class="panel span-7">
      <div class="panel__head">
        <div class="panel__title">${icon("shield")} Vulnerability reports</div>
        <span class="badge">${visible.length} shown</span>
      </div>
      <div class="workloads-toolbar">
        <div class="workloads-toolbar__left">
          <div class="segmented">
            ${[
              ["all", "All"],
              ["critical", "Critical"],
              ["high", "High"],
            ]
              .map(([value, label]) => `<button class="${filter === value ? "is-active" : ""}" data-action="security-filter" data-filter="${value}">${label}</button>`)
              .join("")}
          </div>
        </div>
        <div class="workloads-toolbar__right">
          <div class="search-field">
            ${icon("search")}
            <input id="security-search" type="text" placeholder="Filter images…" value="${escapeHtml(search)}" data-action="security-search" autocomplete="off" spellcheck="false" />
          </div>
        </div>
      </div>
      ${
        sec.loading
          ? `<div class="empty" style="min-height:300px"><div class="spinner"></div><span class="mono faint">loading vulnerability reports…</span></div>`
          : sec.error
            ? `<div style="padding:14px"><div class="risk-banner" data-tone="danger">${icon("alert")}<div>${escapeHtml(sec.error)}</div></div><button class="btn btn--primary" data-action="security-refresh" style="margin-top:10px">${icon("refresh")} Retry</button></div>`
            : visible.length
              ? `<div class="report-list">${visible.map((r) => reportRow(r, selected?.name)).join("")}</div>`
              : `<div class="empty" style="min-height:300px"><div class="empty__icon">${icon("shield-check")}</div><div class="empty__title">No reports match</div><div class="empty__desc">${reports.length ? "Clear the filter or search term to see the full scan." : "The cluster has no vulnerability reports. Install Trivy Operator or run a scanner and refresh."}</div><button class="btn btn--ghost" data-action="security-refresh" style="margin-top:4px">${icon("refresh")} Refresh</button></div>`
      }
      <div class="panel__foot row row--between">
        <span class="mono faint">${reports.length} reports · ${stats.all} findings</span>
        <span class="mono faint">scanner: Trivy reports CRD</span>
      </div>
    </section>

    <section class="panel span-5">
      <div class="panel__head">
        <div class="panel__title">${icon("eye")} Report detail</div>
        <span class="mono faint">${selected ? escapeHtml(selected.kind) : "—"}</span>
      </div>
      <div class="panel__body">${detail(state, selected)}</div>
    </section>
  </div>`;
}
