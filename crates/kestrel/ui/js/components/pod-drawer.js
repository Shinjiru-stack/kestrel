import { bridge } from "../bridge.js";
import { state, emit, addToast } from "../store.js";
import { icon } from "../icons.js";
import {
  escapeHtml,
  fmtAge,
  fmtDateTime,
  fmtTime,
  fmtCpu,
  fmtMemory,
  fmtBytes,
  healthTone,
  statusTone,
  riskTone,
  severityTone,
  highlight,
  copyText,
  shortenImage,
} from "../format.js";
import { openConfirm } from "./modals.js";
import { renderDiagnosis, renderDiagnosisEmpty, renderDiagnosisLoading } from "./diagnosis.js";

let detailSeq = 0;
let logSeq = 0;

const keyOf = (namespace, name) => `${namespace}/${name}`;

function podTone(pod) {
  return healthTone(pod?.health) === "success" ? "success" : healthTone(pod?.health);
}

function badgeForStatus(status) {
  return `<span class="badge badge--dot" data-tone="${statusTone(status)}">${escapeHtml(status || "Unknown")}</span>`;
}

export async function openPod(namespace, name, tab = "overview") {
  const key = keyOf(namespace, name);
  state.selectedPodKey = key;
  state.drawer = {
    open: true,
    tab,
    key,
    detail: null,
    logs: null,
    logsLoading: false,
    loading: true,
    error: "",
    logContainer: "",
    logPrevious: false,
    logSearch: "",
    diagnosis: null,
    diagnosing: false,
    diagnosisError: "",
  };
  emit();
  const seq = ++detailSeq;
  try {
    const detail = await bridge.getPodDetail(namespace, name);
    if (seq !== detailSeq || state.drawer.key !== key) return;
    state.drawer.detail = detail;
    state.drawer.loading = false;
    state.drawer.logContainer = detail.containers?.[0]?.name || "";
    emit();
    if (tab === "logs") loadLogs();
  } catch (err) {
    if (seq !== detailSeq || state.drawer.key !== key) return;
    state.drawer.loading = false;
    state.drawer.error = err?.message || String(err);
    emit();
  }
}

export function closeDrawer() {
  detailSeq += 1;
  logSeq += 1;
  state.drawer.open = false;
  state.selectedPodKey = null;
  emit();
}

export function setDrawerTab(tab) {
  if (!state.drawer.open) return;
  state.drawer.tab = tab;
  emit();
  if (tab === "logs" && !state.drawer.logs && !state.drawer.logsLoading) {
    loadLogs();
  }
}

export function setLogContainer(container) {
  state.drawer.logContainer = container;
  state.drawer.logs = null;
  emit();
  loadLogs();
}

export function setLogPrevious(previous) {
  state.drawer.logPrevious = previous;
  state.drawer.logs = null;
  emit();
  loadLogs();
}

export function setLogSearch(query) {
  state.drawer.logSearch = query;
  emit();
}

export async function loadLogs() {
  const { key, detail, logContainer, logPrevious, tab } = state.drawer;
  if (!key || !detail) return;
  if (tab !== "logs" && state.drawer.logs) return;
  const [namespace, name] = key.split("/");
  const seq = ++logSeq;
  state.drawer.logsLoading = true;
  state.drawer.logs = null;
  emit();
  try {
    const logs = await bridge.getLogs(
      namespace,
      name,
      logContainer || detail.containers?.[0]?.name || "",
      400,
      logPrevious
    );
    if (seq !== logSeq || state.drawer.key !== key) return;
    state.drawer.logs = logs;
    state.drawer.logsLoading = false;
    emit();
  } catch (err) {
    if (seq !== logSeq || state.drawer.key !== key) return;
    state.drawer.logsLoading = false;
    state.drawer.logs = {
      container: logContainer,
      previous: logPrevious,
      lines: [],
      truncated: false,
      error: err?.message || String(err),
    };
    emit();
  }
}

export async function refreshDetail() {
  const { key } = state.drawer;
  if (!key) return;
  const [namespace, name] = key.split("/");
  try {
    const detail = await bridge.getPodDetail(namespace, name);
    if (state.drawer.key !== key) return;
    state.drawer.detail = detail;
    emit();
  } catch {
    /* keep the previous detail */
  }
}

export async function runDiagnosis() {
  const { key, detail } = state.drawer;
  if (!key || !detail) return;
  const [namespace, name] = key.split("/");
  state.drawer.diagnosing = true;
  state.drawer.diagnosisError = "";
  emit();
  try {
    const diagnosis = await bridge.diagnosePod(namespace, name, detail.containers?.[0]?.name || "");
    if (state.drawer.key !== key) return;
    state.drawer.diagnosis = diagnosis;
    state.drawer.diagnosing = false;
    state.ai.diagnosis = diagnosis;
    state.ai.model = diagnosis.model || state.ai.model;
    state.ai.diagnoses = [
      {
        ...diagnosis,
        name: detail.pod.name,
        namespace: detail.pod.namespace,
        at: new Date().toISOString(),
      },
      ...(state.ai.diagnoses || []).filter(
        (d) => !(d.name === detail.pod.name && d.namespace === detail.pod.namespace)
      ),
    ].slice(0, 8);
    emit();
    addToast({
      tone: "success",
      title: "Diagnosis complete",
      description: `${diagnosis.severity || "info"} · ${diagnosis.summary || "Analysis ready"}`,
    });
  } catch (err) {
    if (state.drawer.key !== key) return;
    state.drawer.diagnosing = false;
    state.drawer.diagnosisError = err?.message || String(err);
    emit();
    addToast({ tone: "error", title: "Diagnosis failed", description: state.drawer.diagnosisError });
  }
}

export async function applySuggestion(index) {
  const suggestion = state.drawer.detail?.suggestions?.[index];
  if (!suggestion) return;
  if (!suggestion.action) {
    addToast({
      tone: "info",
      title: "Manual investigation required",
      description: "This finding has no safe automated action. Use the commands in the diagnosis.",
    });
    return;
  }
  const destructive = suggestion.action.type === "deletePod";
  openConfirm({
    title: destructive ? "Delete this pod?" : "Apply remediation?",
    sub: `${suggestion.title}`,
    tone: destructive ? "danger" : "warning",
    iconName: destructive ? "trash" : "wand",
    body: `<div class="risk-banner" data-tone="${destructive ? "danger" : "warning"}">${icon("alert")}<div>${escapeHtml(
      suggestion.description
    )}</div></div>`,
    action: suggestion.action,
    target: `${suggestion.action.kind || "Pod"} · ${suggestion.action.namespace}/${suggestion.action.name}`,
    confirmLabel: destructive ? "Delete pod" : "Apply action",
    confirmTone: destructive ? "danger" : "primary",
    requireText: destructive ? suggestion.action.name : "",
    onConfirm: async () => applyAction(suggestion.action),
  });
}

export async function applyDiagnosisRec(index) {
  const diagnosis = state.drawer.diagnosis || state.ai.diagnosis;
  const rec = diagnosis?.recommendations?.[index];
  if (!rec) return;
  if (!rec.action) {
    addToast({ tone: "info", title: "Manual action", description: "This recommendation has no automated mutation." });
    return;
  }
  const destructive = rec.action.type === "deletePod";
  openConfirm({
    title: "Approve AI remediation?",
    sub: rec.title,
    tone: destructive ? "danger" : "warning",
    iconName: destructive ? "trash" : "sparkles",
    body: `<div class="risk-banner" data-tone="${destructive ? "danger" : "warning"}">${icon("alert")}<div>${escapeHtml(
      rec.detail || ""
    )}</div></div>`,
    action: rec.action,
    target: `${rec.action.kind || "Pod"} · ${rec.action.namespace}/${rec.action.name}`,
    confirmLabel: destructive ? "Delete pod" : "Apply action",
    confirmTone: destructive ? "danger" : "primary",
    requireText: destructive ? rec.action.name : "",
    onConfirm: async () => applyAction(rec.action),
  });
}

async function applyAction(action) {
  try {
    const result = await bridge.runAction(action);
    if (result?.audit) state.audit = result.audit;
    addToast({
      tone: "success",
      title: "Remediation applied",
      description: result?.message || "The cluster accepted the mutation.",
    });
    emit();
    window.dispatchEvent(new CustomEvent("kh:refresh"));
    setTimeout(refreshDetail, 1200);
  } catch (err) {
    addToast({ tone: "error", title: "Remediation blocked", description: err?.message || String(err) });
  }
}

export function restartSelected() {
  const detail = state.drawer.detail;
  if (!detail) return;
  const owner = detail.owner;
  const action =
    owner.kind === "Pod" || owner.standalone
      ? { type: "deletePod", namespace: detail.pod.namespace, name: detail.pod.name }
      : { type: "restartWorkload", kind: owner.kind, namespace: detail.pod.namespace, name: owner.name };
  const destructive = action.type === "deletePod";
  openConfirm({
    title: destructive ? "Delete this standalone pod?" : "Restart the owning workload?",
    sub: destructive
      ? "No controller will recreate this pod."
      : `${owner.kind} ${owner.namespace}/${owner.name} will roll out new pods.`,
    tone: destructive ? "danger" : "warning",
    iconName: "restart",
    body: `<div class="risk-banner" data-tone="${destructive ? "danger" : "warning"}">${icon("alert")}<div>${
      destructive
        ? "Deleting a standalone pod is permanent. Confirm that no external controller owns it."
        : "A rolling restart replaces pods gradually. Readiness gates should keep traffic on healthy replicas."
    }</div></div>`,
    action,
    target: `${action.kind || "Pod"} · ${action.namespace}/${action.name}`,
    confirmLabel: destructive ? "Delete pod" : "Restart workload",
    confirmTone: destructive ? "danger" : "primary",
    requireText: destructive ? action.name : "",
    onConfirm: async () => applyAction(action),
  });
}

export function deleteSelected() {
  const detail = state.drawer.detail;
  if (!detail) return;
  const action = { type: "deletePod", namespace: detail.pod.namespace, name: detail.pod.name };
  openConfirm({
    title: "Delete this pod?",
    sub: "The controller will create a replacement if one owns this pod.",
    tone: "danger",
    iconName: "trash",
    body: `<div class="risk-banner" data-tone="danger">${icon("alert")}<div>This is a destructive action. The pod terminates immediately; in-flight requests may fail. Type the pod name to confirm.</div></div>`,
    action,
    target: `Pod · ${action.namespace}/${action.name}`,
    confirmLabel: "Delete pod",
    confirmTone: "danger",
    requireText: action.name,
    onConfirm: async () => applyAction(action),
  });
}

export async function copyLogs() {
  const lines = state.drawer.logs?.lines || [];
  if (!lines.length) return;
  const text = lines.map((l) => `${l.timestamp || ""} ${l.text}`).join("\n");
  const ok = await copyText(text);
  addToast({
    tone: ok ? "success" : "error",
    title: ok ? "Logs copied" : "Copy failed",
    description: ok ? `${lines.length} lines copied to clipboard.` : "Clipboard access was denied.",
  });
}

export function downloadLogs() {
  const logs = state.drawer.logs;
  if (!logs?.lines?.length) return;
  const name = state.drawer.key?.replace("/", "_") || "pod";
  const text = logs.lines.map((l) => `${l.timestamp || ""} ${l.text}`).join("\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}_${logs.container || "logs"}${logs.previous ? "_previous" : ""}.log`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSkeleton() {
  return `<div class="drawer__content">
    <div class="drawer-head">
      <div class="skeleton" style="width:40px;height:40px;border-radius:11px"></div>
      <div class="drawer-head__text">
        <div class="skeleton" style="width:160px;height:10px;margin-bottom:8px"></div>
        <div class="skeleton" style="width:320px;height:18px"></div>
        <div class="skeleton" style="width:240px;height:9px;margin-top:8px"></div>
      </div>
      <button class="btn btn--icon btn--ghost" data-action="drawer-close" aria-label="Close">${icon("close")}</button>
    </div>
    <div class="drawer-body">
      <div class="detail-grid">${Array.from({ length: 4 }, () => `<div class="skeleton" style="height:52px"></div>`).join("")}</div>
      <div class="skeleton" style="height:120px;margin-top:18px"></div>
      <div class="skeleton" style="height:180px;margin-top:12px"></div>
    </div>
  </div>`;
}

function renderError() {
  return `<div class="drawer__content">
    <div class="drawer-head">
      <div class="drawer-head__mark">${icon("x-circle")}</div>
      <div class="drawer-head__text">
        <div class="drawer-head__eyebrow"><span class="badge" data-tone="critical">error</span></div>
        <div class="drawer-head__title">Could not load pod</div>
        <div class="drawer-head__meta"><span>${escapeHtml(state.drawer.error)}</span></div>
      </div>
      <button class="btn btn--icon btn--ghost" data-action="drawer-close" aria-label="Close">${icon("close")}</button>
    </div>
    <div class="drawer-body">
      <div class="empty">
        <div class="empty__icon">${icon("alert")}</div>
        <div class="empty__title">The pod detail request failed</div>
        <div class="empty__desc">${escapeHtml(state.drawer.error)}</div>
        <div class="empty__actions"><button class="btn btn--primary" data-action="drawer-retry">${icon("refresh")} Retry</button></div>
      </div>
    </div>
  </div>`;
}

function renderHead(detail) {
  const pod = detail.pod;
  const owner = detail.owner;
  const health = podTone(pod);
  const canDelete = owner.kind === "Pod" || owner.standalone;
  return `<div class="drawer-head">
    <div class="drawer-head__mark" data-health="${health}">${icon("cube")}</div>
    <div class="drawer-head__text">
      <div class="drawer-head__eyebrow">
        <span class="health-dot" data-health="${health}"></span>
        <span class="badge">Pod</span>
        ${badgeForStatus(pod.status || pod.phase)}
        ${pod.reason && pod.reason !== pod.status ? `<span class="badge" data-tone="${statusTone(pod.reason)}">${escapeHtml(pod.reason)}</span>` : ""}
      </div>
      <div class="drawer-head__title" title="${escapeHtml(pod.name)}">${escapeHtml(pod.name)}</div>
      <div class="drawer-head__meta">
        <span>${icon("layers")} ${escapeHtml(pod.namespace)}</span>
        <span>${icon("server")} ${escapeHtml(pod.node || "unscheduled")}</span>
        <span>${icon("clock")} ${fmtAge(pod.ageSeconds)}</span>
        <span>${icon("restart")} ${pod.restarts} restarts</span>
        <span>${icon("git-branch")} ${escapeHtml(owner.kind)}/${escapeHtml(owner.name)}</span>
      </div>
    </div>
    <div class="drawer-head__actions">
      <button class="btn btn--sm btn--primary" data-action="drawer-diagnose">${icon("sparkles")} Diagnose</button>
      <button class="btn btn--sm" data-action="drawer-restart" title="Restart owning workload">${icon("restart")}</button>
      ${
        canDelete
          ? `<button class="btn btn--sm btn--danger" data-action="drawer-delete" title="Delete pod">${icon("trash")}</button>`
          : ""
      }
      <button class="btn btn--sm btn--ghost" data-action="drawer-close" aria-label="Close">${icon("close")}</button>
    </div>
  </div>`;
}

function renderTabs(detail) {
  const tab = state.drawer.tab;
  const events = detail.events?.length || 0;
  return `<div class="drawer-tabs tabs" role="tablist">
    <button class="tab${tab === "overview" ? " is-active" : ""}" data-action="drawer-tab" data-tab="overview" role="tab">Overview</button>
    <button class="tab${tab === "logs" ? " is-active" : ""}" data-action="drawer-tab" data-tab="logs" role="tab">Logs</button>
    <button class="tab${tab === "events" ? " is-active" : ""}" data-action="drawer-tab" data-tab="events" role="tab">Events <span class="count">${events}</span></button>
    <button class="tab${tab === "ai" ? " is-active" : ""}" data-action="drawer-tab" data-tab="ai" role="tab">AI <span class="count">${state.drawer.diagnosis ? "1" : "0"}</span></button>
  </div>`;
}

function renderConditions(detail) {
  if (!detail.conditions?.length) return "";
  return `<div class="detail-section">
    <div class="detail-section__head"><span class="detail-section__title">Conditions</span></div>
    <div class="panel panel--inset" style="padding:0 12px">
      ${detail.conditions
        .map(
          (c) => `<div class="condition-row">
            <span class="condition-row__type">${escapeHtml(c.type)}</span>
            <span class="badge badge--dot" data-tone="${c.status === "True" ? "success" : c.status === "False" ? "critical" : "warning"}">${escapeHtml(c.status)}</span>
            <span class="condition-row__message" title="${escapeHtml(c.message || c.reason || "")}">${escapeHtml(c.message || c.reason || "—")}</span>
          </div>`
        )
        .join("")}
    </div>
  </div>`;
}

function renderSuggestions(detail) {
  if (!detail.suggestions?.length) {
    return `<div class="detail-section">
      <div class="detail-section__head"><span class="detail-section__title">Deterministic checks</span></div>
      <div class="risk-banner">${icon("check")}<div>No deterministic remediation signal was found. Ask the Copilot to look for subtler patterns.</div></div>
    </div>`;
  }
  return `<div class="detail-section">
    <div class="detail-section__head">
      <span class="detail-section__title">Deterministic checks</span>
      <span class="mono faint">${detail.suggestions.length} finding${detail.suggestions.length === 1 ? "" : "s"}</span>
    </div>
    ${detail.suggestions
      .map(
        (s, i) => `<div class="suggestion" data-severity="${escapeHtml(s.severity)}">
          <span class="suggestion__icon">${icon(s.kind === "remediation" ? "wand" : "info")}</span>
          <div class="suggestion__body">
            <div class="suggestion__title">
              ${escapeHtml(s.title)}
              <span class="badge" data-tone="${severityTone(s.severity)}">${escapeHtml(s.severity)}</span>
              <span class="badge" data-tone="${riskTone(s.risk)}">${escapeHtml(s.risk)} risk</span>
            </div>
            <div class="suggestion__desc">${escapeHtml(s.description)}</div>
            ${
              s.evidence?.length
                ? `<div class="suggestion__evidence">${s.evidence.map((e) => `<span>· ${escapeHtml(e)}</span>`).join("")}</div>`
                : ""
            }
            <div class="suggestion__foot">
              ${
                s.action
                  ? `<button class="btn btn--sm btn--subtle" data-action="suggestion-apply" data-index="${i}">${icon("play")} Prepare action</button>`
                  : `<span class="mono faint">diagnostic only · no safe auto-action</span>`
              }
            </div>
          </div>
        </div>`
      )
      .join("")}
  </div>`;
}

function renderContainers(detail) {
  if (!detail.containers?.length) return "";
  return `<div class="detail-section">
    <div class="detail-section__head"><span class="detail-section__title">Containers</span></div>
    ${detail.containers
      .map(
        (c) => `<div class="container-card">
          <div class="container-card__head">
            <span class="health-dot" data-health="${c.ready ? "healthy" : "failed"}"></span>
            <span class="container-card__name">${escapeHtml(c.name)}</span>
            <span class="container-card__image" title="${escapeHtml(c.image)}">${escapeHtml(shortenImage(c.image))}</span>
            <span class="badge" data-tone="${statusTone(c.reason || c.state)}">${escapeHtml(c.reason || c.state || "unknown")}</span>
            ${c.restarts ? `<span class="badge" data-tone="warning">${c.restarts} restarts</span>` : ""}
          </div>
          <div class="container-card__body">
            <dl class="kv-grid">
              <div class="kv"><dt>STATE</dt><dd>${escapeHtml(c.state || "—")}</dd></div>
              <div class="kv"><dt>LAST</dt><dd>${escapeHtml(c.lastReason || "—")}</dd></div>
              <div class="kv"><dt>EXIT</dt><dd>${c.exitCode ?? "—"}</dd></div>
              <div class="kv"><dt>STARTED</dt><dd>${c.startedAt ? fmtDateTime(c.startedAt) : "—"}</dd></div>
              <div class="kv"><dt>CPU</dt><dd>${escapeHtml(c.resources?.limits?.cpu || "—")} limit / ${escapeHtml(c.resources?.requests?.cpu || "—")} req</dd></div>
              <div class="kv"><dt>MEM</dt><dd>${escapeHtml(c.resources?.limits?.memory || "—")} limit / ${escapeHtml(c.resources?.requests?.memory || "—")} req</dd></div>
            </dl>
            ${
              c.ports?.length
                ? `<div class="mono faint" style="margin-top:8px;font-size:9px">PORTS ${c.ports.map((p) => `${p.containerPort}/${p.protocol || "TCP"}`).join(" · ")}</div>`
                : ""
            }
            ${
              c.env?.length
                ? `<div class="mono faint" style="margin-top:6px;font-size:9px;line-height:1.7">${c.env
                    .slice(0, 6)
                    .map((e) => `${escapeHtml(e.name)}=${e.value ? escapeHtml(e.value) : `<span class="muted">${escapeHtml(e.source || "secret")}</span>`}`)
                    .join("<br>")}</div>`
                : ""
            }
          </div>
        </div>`
      )
      .join("")}
  </div>`;
}

function renderOverview(detail) {
  const pod = detail.pod;
  return `<div class="detail-grid">
    <div class="detail-chip"><div class="detail-chip__label">Node</div><div class="detail-chip__value">${escapeHtml(pod.node || "unscheduled")}</div></div>
    <div class="detail-chip"><div class="detail-chip__label">Pod IP</div><div class="detail-chip__value">${escapeHtml(detail.podIp || "—")}</div></div>
    <div class="detail-chip"><div class="detail-chip__label">QoS</div><div class="detail-chip__value">${escapeHtml(detail.qosClass || "—")}</div></div>
    <div class="detail-chip"><div class="detail-chip__label">Restarts</div><div class="detail-chip__value">${pod.restarts}</div></div>
    <div class="detail-chip"><div class="detail-chip__label">Age</div><div class="detail-chip__value">${fmtAge(pod.ageSeconds)}</div></div>
    <div class="detail-chip"><div class="detail-chip__label">Owner</div><div class="detail-chip__value" title="${escapeHtml(detail.owner.name)}">${escapeHtml(detail.owner.kind)}/${escapeHtml(detail.owner.name)}</div></div>
    <div class="detail-chip"><div class="detail-chip__label">Service account</div><div class="detail-chip__value">${escapeHtml(detail.serviceAccount || "—")}</div></div>
    <div class="detail-chip"><div class="detail-chip__label">Priority</div><div class="detail-chip__value">${escapeHtml(detail.priorityClass || "—")}</div></div>
  </div>
  ${renderConditions(detail)}
  ${renderSuggestions(detail)}
  ${renderContainers(detail)}
  ${
    pod.images?.length
      ? `<div class="detail-section">
          <div class="detail-section__head"><span class="detail-section__title">Images</span></div>
          ${pod.images.map((img) => `<div class="code-block">${escapeHtml(img)}<button class="copy-btn code-block__copy" data-action="copy" data-copy="${escapeHtml(img)}" aria-label="Copy image">${icon("copy")}</button></div>`).join("")}
        </div>`
      : ""
  }
  ${
    detail.annotations && Object.keys(detail.annotations).length
      ? `<div class="detail-section">
          <div class="detail-section__head"><span class="detail-section__title">Annotations</span></div>
          <div class="code-block">${Object.entries(detail.annotations)
            .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`)
            .join("\n")}</div>
        </div>`
      : ""
  }`;
}

function inferLevel(line) {
  if (line.level) return line.level;
  const t = String(line.text || "");
  if (/\b(error|fatal|panic|exception|killed|oom)\b/i.test(t)) return "error";
  if (/\b(warn|warning|back-off|retry)\b/i.test(t)) return "warn";
  if (/\b(debug|trace)\b/i.test(t)) return "debug";
  return "info";
}

function renderLogs(detail) {
  const d = state.drawer;
  const logs = d.logs;
  const containers = detail.containers || [];
  const lines = logs?.lines || [];
  const search = d.logSearch || "";
  return `<div class="log-view" style="height:calc(100vh - 206px)">
    <div class="log-toolbar">
      <select class="select" data-action="log-container" aria-label="Container">
        ${containers.map((c) => `<option value="${escapeHtml(c.name)}"${c.name === d.logContainer ? " selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
      </select>
      <button class="btn btn--sm${d.logPrevious ? " btn--subtle" : ""}" data-action="log-previous" title="Show previous container logs">${icon("rotate")} Previous</button>
      <div class="search-field" style="min-width:150px;height:28px">
        ${icon("search")}
        <input id="log-search" type="text" placeholder="Filter lines…" value="${escapeHtml(search)}" data-action="log-search" autocomplete="off" spellcheck="false" />
      </div>
      <span class="spacer"></span>
      <button class="btn btn--sm btn--ghost" data-action="log-refresh" title="Refresh logs">${icon("refresh")}</button>
      <button class="btn btn--sm btn--ghost" data-action="log-copy" title="Copy logs">${icon("copy")}</button>
      <button class="btn btn--sm btn--ghost" data-action="log-download" title="Download logs">${icon("download")}</button>
    </div>
    ${
      logs?.error
        ? `<div class="risk-banner" data-tone="danger" style="margin:10px 14px 0">${icon("alert")}<div>${escapeHtml(logs.error)}</div></div>`
        : ""
    }
    <div class="log-scroll">
      ${
        d.logsLoading
          ? `<div class="empty" style="min-height:180px"><div class="spinner"></div><span class="mono faint">reading container logs…</span></div>`
          : lines.length
            ? lines
                .map((line, i) => {
                  const level = inferLevel(line);
                  const text = search ? highlight(line.text, search) : escapeHtml(line.text);
                  return `<div class="log-line" data-level="${level}"><span class="log-line__num">${i + 1}</span><span class="log-line__time">${fmtTime(line.timestamp)}</span><span class="log-line__text">${text}</span></div>`;
                })
                .join("")
            : `<div class="empty" style="min-height:180px"><div class="empty__icon">${icon("logs")}</div><div class="empty__title">No log output</div><div class="empty__desc">${logs?.previous ? "No previous container logs were retained." : "The container has not written to stdout or stderr."}</div></div>`
      }
    </div>
    <div class="log-toolbar" style="border-top:1px solid var(--line-faint);border-bottom:0">
      <span class="mono faint">${lines.length} lines</span>
      <span class="mono faint">${escapeHtml(d.logContainer || "container")}</span>
      ${d.logPrevious ? `<span class="badge" data-tone="warning">previous instance</span>` : ""}
      ${logs?.truncated ? `<span class="badge">truncated</span>` : ""}
      <span class="spacer"></span>
      <span class="mono faint">${logs?.error ? "error" : "stream complete"}</span>
    </div>
  </div>`;
}

function renderEvents(detail) {
  const events = detail.events || [];
  if (!events.length) {
    return `<div class="empty" style="min-height:280px">
      <div class="empty__icon">${icon("bell-off")}</div>
      <div class="empty__title">No recent events</div>
      <div class="empty__desc">The API server has no events involving this pod or its owner. That usually means a quiet, stable workload.</div>
    </div>`;
  }
  return `<div class="detail-section" style="margin-top:0">
    <div class="detail-section__head">
      <span class="detail-section__title">Event stream</span>
      <span class="mono faint">${events.length} events</span>
    </div>
    <div class="event-list">
      ${events
        .map(
          (e) => `<div class="event-item">
            <span class="event-item__icon" data-tone="${e.type === "Warning" ? "warning" : "info"}">${icon(e.type === "Warning" ? "alert" : "info")}</span>
            <div class="event-item__body">
              <div class="event-item__head">
                <span class="event-item__reason">${escapeHtml(e.reason)}</span>
                ${e.count > 1 ? `<span class="badge" data-tone="warning">×${e.count}</span>` : ""}
                <span class="event-item__time">${fmtDateTime(e.lastSeen)}</span>
              </div>
              <div class="event-item__message">${escapeHtml(e.message)}</div>
              <div class="event-item__meta mono faint" style="margin-top:3px;font-size:8.5px">${escapeHtml(e.source || "kubelet")} · ${escapeHtml(e.involvedKind || "Pod")}/${escapeHtml(e.involvedName || "")}</div>
            </div>
          </div>`
        )
        .join("")}
    </div>
  </div>`;
}

function renderAi(detail) {
  const d = state.drawer;
  if (d.diagnosing) {
    return `<div style="padding-top:8px">${renderDiagnosisLoading()}</div>`;
  }
  if (d.diagnosisError) {
    return `<div class="risk-banner" data-tone="danger" style="margin-bottom:12px">${icon("alert")}<div>${escapeHtml(d.diagnosisError)}</div></div>
      <button class="btn btn--primary" data-action="drawer-diagnose">${icon("wand")} Retry diagnosis</button>`;
  }
  if (d.diagnosis) {
    return `${renderDiagnosis(d.diagnosis)}
      <div class="row" style="margin-top:14px">
        <button class="btn btn--sm" data-action="drawer-diagnose">${icon("refresh")} Re-run</button>
        <button class="btn btn--sm btn--ghost" data-action="open-copilot-diagnosis">${icon("sparkles")} Continue in Copilot</button>
      </div>`;
  }
  return renderDiagnosisEmpty({
    title: "Diagnose this pod with AI",
    desc: "Send the pod status, conditions, warning events, and recent logs to the active provider. You get a root cause, confidence, evidence, and approval-gated remediations.",
    action: "drawer-diagnose",
    label: "Run diagnosis",
  });
}

export function renderDrawer() {
  if (!state.drawer.open) return "";
  if (state.drawer.loading) return renderSkeleton();
  if (state.drawer.error) return renderError();
  const detail = state.drawer.detail;
  if (!detail) return renderSkeleton();
  const body =
    state.drawer.tab === "logs"
      ? renderLogs(detail)
      : state.drawer.tab === "events"
        ? renderEvents(detail)
        : state.drawer.tab === "ai"
          ? renderAi(detail)
          : renderOverview(detail);
  return `<div class="drawer__content">
    ${renderHead(detail)}
    ${renderTabs(detail)}
    <div class="drawer-body${state.drawer.tab === "logs" ? " drawer-body--flush" : ""}">${body}</div>
  </div>`;
}
