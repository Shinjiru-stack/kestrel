import { bridge } from "./bridge.js";
import {
  state,
  emit,
  subscribe,
  addToast,
  removeToast,
  resetDrawer,
} from "./store.js";
import { icon } from "./icons.js";
import { escapeHtml, copyText, fmtDateTime, humanize } from "./format.js";
import { sparkline } from "./components/charts.js";
import { renderToasts } from "./components/toasts.js";
import { openInfo, closeModal, confirmModal } from "./components/modals.js";
import {
  configurePalette,
  renderPalette,
  paletteMove,
  paletteSelect,
} from "./components/command-palette.js";
import {
  renderDrawer,
  openPod,
  closeDrawer,
  setDrawerTab,
  setLogContainer,
  setLogPrevious,
  setLogSearch,
  loadLogs,
  runDiagnosis,
  applySuggestion,
  applyDiagnosisRec,
  restartSelected,
  deleteSelected,
  copyLogs,
  downloadLogs,
} from "./components/pod-drawer.js";
import { renderOverview } from "./views/overview.js";
import { renderWorkloads } from "./views/workloads.js";
import { renderNodes } from "./views/nodes.js";
import { renderCopilot } from "./views/copilot.js";
import { renderSecurity } from "./views/security.js";
import { renderSettings } from "./views/settings.js";

const ROUTES = new Set(["overview", "workloads", "nodes", "copilot", "security", "settings"]);
const DEFAULT_SAFETY = {
  protectedNamespaces: ["kube-system", "kube-public", "kube-node-lease"],
  requireConfirmation: true,
  maxOomPatchCount: 3,
  maxMemoryMi: 1024,
  allowDestructive: false,
  redactLogs: true,
};

let renderQueued = false;
let lastViewHtml = "";
let lastViewRoute = "";
let lastDrawerHtml = "";
let lastPulseHtml = "";
let backgroundStarted = false;
let unsubSnapshot = null;
let unsubStatus = null;
let pollTimer = null;
let refreshing = false;
let lastChatCount = 0;
let gPrefixAt = 0;

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function setPath(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
}

function getPath(target, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), target);
}

function applyPreferences() {
  document.documentElement.dataset.theme = state.theme || "light";
  document.documentElement.dataset.density = state.density || "comfortable";
  document.documentElement.dataset.motion = state.settings?.appearance?.reduceMotion ? "reduced" : "full";
}

function routeLabel(route) {
  return route.charAt(0).toUpperCase() + route.slice(1);
}

function parseHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "").trim();
  if (!raw) return { route: "overview", params: {} };
  const [routeRaw, tab] = raw.split("/");
  const route = ROUTES.has(routeRaw) ? routeRaw : "overview";
  return { route, params: tab ? { tab } : {} };
}

function navigate(route, params = {}) {
  const safe = ROUTES.has(route) ? route : "overview";
  state.route = safe;
  state.routeParams = params;
  if (safe === "settings" && params.tab) state.settingsTab = params.tab;
  const hash = `#/${safe}${params.tab ? `/${params.tab}` : ""}`;
  if (location.hash !== hash) {
    location.hash = hash;
  } else {
    emit();
  }
}

function bootStatus(text) {
  const el = document.getElementById("boot-status");
  if (el) el.textContent = text;
}

function hideBoot() {
  const boot = document.getElementById("boot");
  const shell = document.getElementById("shell");
  if (shell) shell.hidden = false;
  if (!boot) return;
  boot.classList.add("is-done");
  setTimeout(() => {
    boot.hidden = true;
  }, 440);
}

function aggregatePoint(snapshot) {
  const nodes = snapshot.nodes || [];
  const cpuCapacity = nodes.reduce((sum, n) => sum + (Number(n.cpuCores) || 0), 0);
  const memoryCapacity = nodes.reduce((sum, n) => sum + (Number(n.memoryBytes) || 0), 0);
  const cpu = cpuCapacity
    ? nodes.reduce((sum, n) => sum + (Number(n.cpuUsage) || 0), 0) / cpuCapacity
    : 0;
  const memory = memoryCapacity
    ? nodes.reduce((sum, n) => sum + (Number(n.memoryUsage) || 0), 0) / memoryCapacity
    : 0;
  return { t: Date.now(), cpu: Math.max(0, Math.min(1, cpu)), memory: Math.max(0, Math.min(1, memory)) };
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  state.snapshot = snapshot;
  state.connected = true;
  state.connectionError = "";
  if (Array.isArray(snapshot.history) && snapshot.history.length) {
    state.history = snapshot.history.slice(-48);
  } else {
    const last = state.history[state.history.length - 1];
    if (!last || Date.now() - (Number(last.t) || 0) > 2500) {
      state.history = [...state.history, aggregatePoint(snapshot)].slice(-48);
    }
  }
  state.lastUpdated = new Date();
  emit();
}

function resetClusterData() {
  state.snapshot = null;
  state.history = [];
  state.lastUpdated = null;
  state.security = {
    ...state.security,
    reports: [],
    loading: false,
    loaded: false,
    error: "",
    selected: null,
  };
  resetDrawer();
}

function markDisconnected(message) {
  state.connected = false;
  state.connecting = false;
  state.connectionError = message || "Cluster link lost.";
  resetClusterData();
  emit();
}

async function connect() {
  if (state.connecting) return;
  state.connecting = true;
  state.connectionError = "";
  resetClusterData();
  emit();
  bootStatus("Opening kubeconfig and probing the API server");
  try {
    const snapshot = await bridge.connectCluster({
      kubeconfigPath: state.settings?.kubeconfigPath || "",
      context: state.settings?.context || "",
    });
    state.connecting = false;
    applySnapshot(snapshot);
    state.booted = true;
    hideBoot();
    addToast({
      tone: "success",
      title: "Cluster link established",
      description: `${snapshot?.cluster?.name || "cluster"} · ${snapshot?.pods?.length || 0} pods · ${snapshot?.nodes?.length || 0} nodes`,
      timeout: 3800,
    });
    startBackground();
  } catch (err) {
    state.connecting = false;
    markDisconnected(err?.message || String(err));
    state.booted = true;
    hideBoot();
    addToast({
      tone: "error",
      title: "Could not reach the cluster",
      description: state.connectionError,
      timeout: 8000,
    });
  }
}

async function refreshSnapshot({ silent = false } = {}) {
  if (refreshing) return;
  if (!state.connected) {
    if (!state.connecting) await connect();
    return;
  }
  refreshing = true;
  try {
    const snapshot = await bridge.refreshSnapshot();
    applySnapshot(snapshot);
    if (!silent) {
      addToast({
        tone: "success",
        title: "Snapshot refreshed",
        description: `${snapshot?.pods?.length || 0} pods · ${snapshot?.events?.length || 0} events`,
        timeout: 2600,
      });
    }
  } catch (err) {
    const message = err?.message || String(err);
    // Any failed poll means the displayed snapshot can no longer be trusted.
    // Clear it immediately so a dead tunnel never looks like a healthy cluster.
    markDisconnected(message);
    if (!silent) addToast({ tone: "error", title: "Refresh failed", description: message, timeout: 6000 });
  } finally {
    refreshing = false;
  }
}

async function checkForUpdates({ silent = true, force = false } = {}) {
  if (state.update.checking) return;
  if (!force && state.update.checkedAt) {
    const age = Date.now() - state.update.checkedAt.getTime();
    if (age < 6 * 60 * 60 * 1000) return;
  }
  state.update.checking = true;
  state.update.error = "";
  emit();
  try {
    const info = await bridge.checkForUpdates();
    state.update.info = info || null;
    state.update.checked = true;
    state.update.checkedAt = new Date();
    if (!silent) {
      if (info) {
        addToast({
          tone: "info",
          title: `Kestrel ${info.latestVersion} is available`,
          description: "Open the release page to download the update.",
          timeout: 7000,
        });
      } else {
        addToast({
          tone: "success",
          title: "Kestrel is up to date",
          description: `You are running ${state.appVersion}.`,
          timeout: 3600,
        });
      }
    }
  } catch (err) {
    state.update.error = err?.message || String(err);
    if (!silent) {
      addToast({
        tone: "error",
        title: "Update check failed",
        description: state.update.error,
        timeout: 7000,
      });
    }
  } finally {
    state.update.checking = false;
    emit();
  }
}

function openUpdateModal() {
  const info = state.update.info;
  if (!info) {
    checkForUpdates({ silent: false, force: true });
    return;
  }
  const notes = (info.notes || "").trim();
  openInfo({
    title: `Kestrel ${info.latestVersion} is available`,
    sub: `You are running ${info.currentVersion}. Installing stays a manual step.`,
    tone: "info",
    iconName: "download",
    hideFoot: true,
    body: `${
      notes
        ? `<pre class="update-notes">${escapeHtml(notes)}</pre>`
        : `<p class="faint">See the release page for the full release notes.</p>`
    }
      <div class="row" style="margin-top:14px">
        <button class="btn btn--primary" data-action="update-release">${icon("external")} Open release page</button>
        <button class="btn btn--ghost" data-action="update-dismiss">Remind me later</button>
      </div>`,
  });
}

function dismissUpdate() {
  const info = state.update.info;
  if (info?.latestVersion) {
    state.update.dismissedVersion = info.latestVersion;
    localStorage.setItem("kh-dismissed-update", info.latestVersion);
  }
  closeModal();
  emit();
}

function openUpdateRelease() {
  const url = state.update.info?.url || "";
  if (!/^https?:\/\//i.test(url)) {
    addToast({ tone: "warning", title: "Link blocked", description: "Only http(s) links can be opened." });
    return;
  }
  bridge.openUrl(url).catch((err) =>
    addToast({ tone: "error", title: "Could not open release page", description: err?.message || String(err) })
  );
  closeModal();
}

function startBackground() {
  if (backgroundStarted) return;
  backgroundStarted = true;
  unsubSnapshot = bridge.onSnapshot((snapshot) => applySnapshot(snapshot));
  unsubStatus = bridge.onStatus((status) => {
    if (!status) return;
    if (status.connected === false) {
      markDisconnected(status.detail || status.message || "Cluster link lost.");
    } else if (status.connected === true) {
      state.connected = true;
      state.connectionError = "";
      emit();
    }
  });
  pollTimer = setInterval(() => {
    if (state.connected && document.visibilityState === "visible") refreshSnapshot({ silent: true });
  }, 20000);
  setTimeout(() => loadSecurity({ silent: true }), 1800);
}

function renderSidebar() {
  const snapshot = state.snapshot;
  const cluster = snapshot?.cluster;
  const nameEl = document.getElementById("cluster-name");
  const metaEl = document.getElementById("cluster-meta");
  if (nameEl) nameEl.textContent = cluster?.name || (state.connecting ? "connecting…" : "no cluster");
  if (metaEl) {
    metaEl.textContent = cluster
      ? `${cluster.provider || "k8s"} · ${cluster.version || "unknown"}${snapshot?.warnings?.length ? " · partial data" : ""}`
      : state.connectionError
        ? "link offline"
        : "waiting for link";
  }

  const updatePill = document.getElementById("update-pill");
  if (updatePill) {
    const info = state.update?.info;
    const visible = Boolean(info?.latestVersion && info.latestVersion !== state.update?.dismissedVersion);
    updatePill.hidden = !visible;
    if (visible) {
      const label = document.getElementById("update-pill-label");
      if (label) label.textContent = `Update ${info.latestVersion}`;
      updatePill.title = `Kestrel ${info.latestVersion} is available`;
    }
  }

  const linkPill = document.getElementById("link-pill");
  const linkLabel = document.getElementById("link-label");
  const linkStatus = state.connected ? "connected" : state.connecting ? "connecting" : "error";
  if (linkPill) {
    const dot = linkPill.querySelector(".status-dot");
    if (dot) dot.dataset.status = linkStatus;
  }
  if (linkLabel) linkLabel.textContent = state.connected ? "LIVE" : state.connecting ? "SYNC" : "OFFLINE";

  const pods = snapshot?.pods || [];
  const healthy = pods.filter((p) => p.health === "healthy").length;
  const issues = pods.filter((p) => p.health !== "healthy").length;
  const healthyEl = document.getElementById("side-healthy");
  const issuesEl = document.getElementById("side-issues");
  if (healthyEl) healthyEl.textContent = String(healthy);
  if (issuesEl) issuesEl.textContent = String(issues);

  const pulseHost = document.getElementById("sidebar-pulse");
  if (pulseHost) {
    const values = state.connected ? state.history.map((h) => Number(h.cpu) || 0) : [0, 0];
    const html = sparkline(values, {
      width: 210,
      height: 44,
      pad: 3,
      color: state.connected ? "var(--mint)" : "var(--text-faint)",
      strokeWidth: 1.5,
    });
    if (html !== lastPulseHtml) {
      pulseHost.innerHTML = html;
      lastPulseHtml = html;
    }
  }
  const pulseLive = document.getElementById("pulse-live");
  if (pulseLive) pulseLive.innerHTML = `<i></i> ${state.connected ? "LIVE" : "OFFLINE"}`;

  const podsBadge = document.getElementById("nav-pods-badge");
  if (podsBadge) {
    podsBadge.textContent = String(issues);
    podsBadge.hidden = issues === 0;
  }
  const reports = state.security.reports || [];
  const securityCount = reports.reduce(
    (sum, r) => sum + (Number(r.summary?.critical) || 0) + (Number(r.summary?.high) || 0),
    0
  );
  const securityBadge = document.getElementById("nav-security-badge");
  if (securityBadge) {
    securityBadge.textContent = String(securityCount);
    securityBadge.hidden = securityCount === 0;
  }

  const provider = (state.settings?.providers || []).find(
    (p) => p.kind === state.settings?.activeProvider
  );
  const providerName = document.getElementById("provider-name");
  const providerModel = document.getElementById("provider-model");
  const providerMark = document.getElementById("provider-mark");
  const providerDot = document.getElementById("provider-dot");
  if (providerName) providerName.textContent = provider?.label || "Configure AI";
  if (providerModel) providerModel.textContent = provider?.model || "no provider selected";
  if (providerMark) {
    const marks = { ollama: "OL", gemini: "G", openrouter: "OR", anthropic: "AN", githubCopilot: "GH" };
    providerMark.textContent = marks[provider?.kind] || "AI";
  }
  if (providerDot) {
    providerDot.dataset.status =
      provider?.status === "ready" ? "connected" : provider?.status === "error" ? "error" : "warning";
  }

  const themeIcon = document.getElementById("theme-icon");
  const themeLabel = document.getElementById("theme-label");
  if (themeIcon) themeIcon.innerHTML = `<use href="#i-${state.theme === "dark" ? "moon" : "sun"}"></use>`;
  if (themeLabel) themeLabel.textContent = state.theme === "dark" ? "Light mode" : "Dark mode";

  const windowControls = document.getElementById("window-controls");
  if (windowControls) windowControls.hidden = !state.isTauri;

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.nav === state.route);
  });
}

function disconnectedView() {
  const path = state.settings?.kubeconfigPath || "no kubeconfig selected";
  return `<div class="disconnected">
    <div class="disconnected__orb">${icon("network")}</div>
    <div class="eyebrow">Signal lost</div>
    <h1>No signal from the cluster.</h1>
    <p>${escapeHtml(state.connectionError || "The app has not received a cluster snapshot yet.")}</p>
    <div class="disconnected__path mono">${escapeHtml(path)}</div>
    <div class="disconnected__actions">
      <button class="btn btn--primary" data-action="retry-connect">${icon("refresh")} Retry connection</button>
      <button class="btn btn--ghost" data-action="settings">${icon("settings")} Open connection settings</button>
    </div>
    <div class="disconnected__hint">The desktop app reads the kubeconfig from disk and connects directly to the API server endpoint it defines. Make sure that endpoint is reachable before connecting.</div>
    <div class="disconnected__grid">
      <div><span>kubeconfig</span><strong class="mono">${escapeHtml(path)}</strong></div>
      <div><span>context</span><strong class="mono">${escapeHtml(state.settings?.context || "current context")}</strong></div>
      <div><span>endpoint</span><strong class="mono">${escapeHtml(state.snapshot?.cluster?.server || "resolved from kubeconfig")}</strong></div>
    </div>
  </div>`;
}

function snapshotWarning() {
  const warnings = state.snapshot?.warnings || [];
  if (!state.connected || !warnings.length) return "";
  const shown = warnings.slice(0, 2).map((warning) => escapeHtml(warning)).join(" · ");
  const extra = warnings.length > 2 ? ` · +${warnings.length - 2} more` : "";
  return `<div class="data-warning" role="status">
    ${icon("alert")}
    <div><strong>Partial cluster data.</strong> ${shown}${extra}</div>
  </div>`;
}

function currentView() {
  if (!state.connected || !state.snapshot) {
    return state.route === "settings" ? renderSettings(state) : disconnectedView();
  }
  let view = "";
  switch (state.route) {
    case "workloads":
      view = renderWorkloads(state);
      break;
    case "nodes":
      view = renderNodes(state);
      break;
    case "copilot":
      view = renderCopilot(state);
      break;
    case "security":
      view = renderSecurity(state);
      break;
    case "settings":
      view = renderSettings(state);
      break;
    default:
      view = renderOverview(state);
      break;
  }
  return `${snapshotWarning()}${view}`;
}

function captureFocus() {
  const el = document.activeElement;
  if (!el || !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return null;
  return {
    id: el.id || "",
    action: el.dataset?.action || "",
    start: typeof el.selectionStart === "number" ? el.selectionStart : null,
    end: typeof el.selectionEnd === "number" ? el.selectionEnd : null,
  };
}

function restoreFocus(saved) {
  if (!saved) return;
  let el = saved.id ? document.getElementById(saved.id) : null;
  if (!el && saved.action) el = document.querySelector(`[data-action="${saved.action}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (saved.start != null && typeof el.setSelectionRange === "function") {
    try {
      el.setSelectionRange(saved.start, saved.end ?? saved.start);
    } catch {
      /* some input types reject selection */
    }
  }
}

function autoGrow(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(170, Math.max(38, el.scrollHeight))}px`;
}

function updateChatSend() {
  const btn = document.querySelector('[data-action="chat-send"]');
  if (btn) btn.disabled = state.ai.streaming || !(state.ai.draft || "").trim();
}

function render() {
  applyPreferences();
  const shell = document.getElementById("shell");
  if (shell && state.booted) shell.hidden = false;

  const savedFocus = captureFocus();
  const main = document.querySelector(".main");
  const mainScroll = main?.scrollTop || 0;
  const drawerBody = document.querySelector(".drawer-body");
  const drawerScroll = drawerBody?.scrollTop || 0;
  const logScroll = document.querySelector(".log-scroll");
  const logScrollTop = logScroll?.scrollTop || 0;
  const chat = document.getElementById("chat-messages");
  const chatWasAtBottom = chat ? chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80 : false;
  const chatCount = state.ai.messages.length;

  renderSidebar();

  const view = document.getElementById("view");
  const viewHtml = currentView();
  const viewKey = `${state.route}:${JSON.stringify(state.routeParams)}`;
  if (view && (viewHtml !== lastViewHtml || viewKey !== lastViewRoute)) {
    view.innerHTML = viewHtml;
    lastViewHtml = viewHtml;
    lastViewRoute = viewKey;
  }

  const drawer = document.getElementById("drawer");
  const drawerHtml = renderDrawer();
  if (drawer) {
    drawer.hidden = !drawerHtml;
    if (drawerHtml) {
      const host = document.getElementById("drawer-content");
      if (host && drawerHtml !== lastDrawerHtml) {
        host.innerHTML = drawerHtml;
        lastDrawerHtml = drawerHtml;
      }
    } else {
      const host = document.getElementById("drawer-content");
      if (host) host.innerHTML = "";
      lastDrawerHtml = "";
    }
  }

  renderToasts(state);
  if (state.palette.open) renderPalette(state);

  const palette = document.getElementById("palette");
  if (palette) palette.hidden = !state.palette.open;

  if (main) main.scrollTop = mainScroll;
  const nextDrawerBody = document.querySelector(".drawer-body");
  if (nextDrawerBody) nextDrawerBody.scrollTop = drawerScroll;
  const nextLogScroll = document.querySelector(".log-scroll");
  if (nextLogScroll) nextLogScroll.scrollTop = logScrollTop;

  const nextChat = document.getElementById("chat-messages");
  if (nextChat) {
    if (state.ai.streaming || chatCount !== lastChatCount || chatWasAtBottom) {
      nextChat.scrollTop = nextChat.scrollHeight;
    }
  }
  lastChatCount = chatCount;

  const chatInput = document.getElementById("chat-input");
  if (chatInput) autoGrow(chatInput);

  if (state.route === "security" && !state.security.loading && !state.security.loaded) {
    queueMicrotask(() => loadSecurity());
  }

  restoreFocus(savedFocus);
}

async function loadSecurity({ force = false, silent = false } = {}) {
  const sec = state.security;
  if (!state.connected || !state.snapshot) return;
  if (sec.loading) return;
  if (sec.loaded && !force) return;
  sec.loading = true;
  sec.error = "";
  emit();
  try {
    const reports = await bridge.getSecurityReports();
    sec.reports = Array.isArray(reports) ? reports : [];
    sec.loaded = true;
    if (sec.selected && !sec.reports.some((r) => r.name === sec.selected)) {
      sec.selected = null;
    }
  } catch (err) {
    sec.error = err?.message || String(err);
    sec.loaded = true;
    if (!silent) {
      addToast({ tone: "error", title: "Security scan unavailable", description: sec.error, timeout: 7000 });
    }
  } finally {
    sec.loading = false;
    emit();
  }
}

function collectSettings() {
  if (!state.settings) return null;
  const next = structuredClone(state.settings);
  document.querySelectorAll("[data-settings-field]").forEach((el) => {
    const path = el.dataset.settingsField;
    let value = el.value;
    if (path === "safety.protectedNamespaces") {
      value = String(el.value || "")
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (el.type === "number") {
      value = Number(el.value);
    }
    setPath(next, path, value);
  });
  document.querySelectorAll("[data-provider-kind][data-provider-field]").forEach((el) => {
    const provider = next.providers?.find((p) => p.kind === el.dataset.providerKind);
    if (!provider) return;
    const field = el.dataset.providerField;
    if (field === "apiKey") {
      if (String(el.value || "").trim()) provider.apiKey = el.value.trim();
      return;
    }
    provider[field] = el.value;
  });
  const active = next.providers?.find((p) => p.kind === next.activeProvider);
  if (active) next.activeModel = active.model;
  state.settings = next;
  return next;
}

async function saveSettings({ toast = true } = {}) {
  const next = collectSettings();
  if (!next) return null;
  state.settingsUi.saving = true;
  emit();
  try {
    const saved = await bridge.saveSettings(next);
    state.settings = saved || next;
    state.settingsUi.saving = false;
    emit();
    if (toast) addToast({ tone: "success", title: "Settings saved", description: "Configuration written to this machine.", timeout: 2800 });
    return state.settings;
  } catch (err) {
    state.settingsUi.saving = false;
    emit();
    addToast({ tone: "error", title: "Could not save settings", description: err?.message || String(err), timeout: 6000 });
    return null;
  }
}

async function persistPreferences() {
  if (!state.settings) return;
  state.settings.appearance = {
    ...(state.settings.appearance || {}),
    theme: state.theme,
    density: state.density,
  };
  try {
    const saved = await bridge.saveSettings(state.settings);
    state.settings = saved || state.settings;
    emit();
  } catch {
    /* preference persistence is best effort */
  }
}

function toggleTheme(next) {
  const target = next || (state.theme === "dark" ? "light" : "dark");
  state.theme = target;
  localStorage.setItem("kh-theme", target);
  applyPreferences();
  persistPreferences();
  emit();
}

function setDensity(next) {
  state.density = next;
  localStorage.setItem("kh-density", next);
  applyPreferences();
  persistPreferences();
  emit();
}

function toggleSettingsPath(path) {
  collectSettings();
  const current = Boolean(getPath(state.settings, path));
  setPath(state.settings, path, !current);
  applyPreferences();
  emit();
}

function resetSafety() {
  collectSettings();
  state.settings.safety = structuredClone(DEFAULT_SAFETY);
  emit();
  addToast({ tone: "info", title: "Guardrail defaults restored", description: "Save the settings to persist this change.", timeout: 4200 });
}

function providerFor(kind) {
  return (state.settings?.providers || []).find((p) => p.kind === kind);
}

async function saveProvider(kind, { toast = false } = {}) {
  collectSettings();
  const provider = providerFor(kind);
  if (provider) state.settings.activeModel = providerFor(state.settings.activeProvider)?.model || state.settings.activeModel;
  const saved = await saveSettings({ toast: false });
  if (toast && saved) {
    addToast({ tone: "success", title: `${provider?.label || "Provider"} saved`, description: "Provider configuration is up to date.", timeout: 2800 });
  }
  return saved;
}

async function testProvider(kind) {
  const provider = providerFor(kind);
  if (!provider) return;
  await saveProvider(kind);
  state.settingsUi.testing = kind;
  provider.status = "testing";
  emit();
  try {
    const result = await bridge.testProvider(kind);
    provider.models = result?.models || provider.models || [];
    provider.latencyMs = Number(result?.latencyMs) || 0;
    provider.status = result?.status || (provider.models.length ? "ready" : "error");
    state.settingsUi.testing = "";
    await bridge.saveSettings(state.settings);
    emit();
    addToast({
      tone: provider.status === "ready" ? "success" : "warning",
      title: `${provider.label} ${provider.status === "ready" ? "is ready" : "returned no models"}`,
      description: `${provider.models.length} models · ${provider.latencyMs} ms`,
      timeout: 4200,
    });
  } catch (err) {
    provider.status = "error";
    provider.latencyMs = 0;
    state.settingsUi.testing = "";
    emit();
    addToast({ tone: "error", title: `${provider.label} test failed`, description: err?.message || String(err), timeout: 7000 });
  }
}

async function refreshModelLists() {
  await saveSettings({ toast: false });
  const providers = (state.settings?.providers || []).filter((p) => p.enabled);
  let updated = 0;
  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      const models = await bridge.listModels(provider.kind);
      if (Array.isArray(models) && models.length) {
        provider.models = models;
        updated += 1;
      }
    })
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  emit();
  addToast({
    tone: failed ? "warning" : "success",
    title: "Model lists refreshed",
    description: `${updated} providers updated${failed ? ` · ${failed} failed` : ""}.`,
    timeout: 4000,
  });
}

async function refreshAudit() {
  try {
    state.audit = await bridge.getAudit();
    emit();
  } catch (err) {
    addToast({ tone: "error", title: "Audit log unavailable", description: err?.message || String(err) });
  }
}

async function reloadSettings() {
  try {
    const boot = await bridge.bootstrap();
    if (boot?.settings) state.settings = boot.settings;
    if (boot?.audit) state.audit = boot.audit;
    state.settingsUi.expandedProvider = state.settings?.activeProvider || "ollama";
    emit();
    addToast({ tone: "success", title: "Settings reloaded", description: "Read from the local settings file.", timeout: 2600 });
  } catch (err) {
    addToast({ tone: "error", title: "Reload failed", description: err?.message || String(err) });
  }
}

function chatContext() {
  const snapshot = state.snapshot;
  const detail = state.drawer.open ? state.drawer.detail : null;
  let pod = null;
  if (detail) {
    pod = {
      namespace: detail.pod.namespace,
      name: detail.pod.name,
      phase: detail.pod.phase,
      status: detail.pod.status,
      reason: detail.pod.reason,
      ready: detail.pod.ready,
      restarts: detail.pod.restarts,
      node: detail.pod.node,
      ageSeconds: detail.pod.ageSeconds,
      owner: detail.owner,
      conditions: detail.conditions,
      containers: detail.containers,
      events: detail.events,
      recentLogs: (state.drawer.logs?.lines || []).slice(-80).map((l) => l.text),
    };
  } else if (state.selectedPodKey) {
    const [namespace, name] = state.selectedPodKey.split("/");
    const summary = (snapshot?.pods || []).find((p) => p.namespace === namespace && p.name === name);
    if (summary) {
      pod = {
        namespace: summary.namespace,
        name: summary.name,
        phase: summary.phase,
        status: summary.status,
        reason: summary.reason,
        ready: summary.ready,
        restarts: summary.restarts,
        node: summary.node,
        ageSeconds: summary.ageSeconds,
        owner: summary.owner,
      };
    }
  }
  return {
    cluster: snapshot?.cluster || null,
    pod,
    nodes: (snapshot?.nodes || []).map((n) => ({
      name: n.name,
      status: n.status,
      roles: n.roles,
      cpuUsage: n.cpuUsage,
      cpuCores: n.cpuCores,
      memoryUsage: n.memoryUsage,
      memoryBytes: n.memoryBytes,
      pods: n.pods,
      podCapacity: n.podCapacity,
      conditions: n.conditions,
    })),
    workloads: (snapshot?.workloads || []).slice(0, 40),
    recentEvents: (snapshot?.events || []).filter((e) => e.type === "Warning").slice(0, 30),
    security: (state.security.reports || []).slice(0, 8).map((r) => ({
      workload: r.workload,
      namespace: r.namespace,
      container: r.container,
      summary: r.summary,
    })),
  };
}

async function sendChat(override) {
  if (state.ai.streaming) return;
  const text = String(override ?? state.ai.draft ?? "").trim();
  if (!text) return;
  const at = new Date().toISOString();
  const user = { role: "user", content: text, at };
  const assistant = {
    role: "assistant",
    content: "",
    at,
    model: state.settings?.activeModel || "",
    id: `msg-${Date.now()}`,
  };
  state.ai.messages = [...state.ai.messages, user, assistant];
  state.ai.draft = "";
  state.ai.streaming = true;
  state.ai.error = "";
  state.ai.requestId = assistant.id;
  emit();

  const history = state.ai.messages
    .slice(0, -1)
    .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
    .slice(-20)
    .map(({ role, content }) => ({ role, content }));

  try {
    const response = await bridge.chat(history, chatContext(), (delta) => {
      const last = state.ai.messages[state.ai.messages.length - 1];
      if (!last) return;
      last.content += delta;
      emit();
    });
    const last = state.ai.messages[state.ai.messages.length - 1];
    if (last) {
      if (response?.content) last.content = response.content;
      last.usage = response?.usage;
      last.model = response?.model || last.model;
      state.ai.model = last.model;
    }
    state.ai.streaming = false;
    emit();
  } catch (err) {
    const last = state.ai.messages[state.ai.messages.length - 1];
    if (last && !last.content) last.content = "";
    state.ai.streaming = false;
    state.ai.error = err?.message || String(err);
    emit();
    addToast({ tone: "error", title: "Copilot request failed", description: state.ai.error, timeout: 7000 });
  }
}

function openPalette() {
  state.palette.open = true;
  state.palette.query = "";
  state.palette.index = 0;
  emit();
  requestAnimationFrame(() => {
    const input = document.getElementById("palette-input");
    if (input) {
      input.value = "";
      input.focus();
    }
    renderPalette(state);
  });
}

function closePalette() {
  state.palette.open = false;
  state.palette.query = "";
  state.palette.index = 0;
  emit();
}

function handlePaletteAction(item) {
  const action = item?.action;
  if (!action) return;
  closePalette();
  switch (action.type) {
    case "navigate":
      navigate(action.route, action.tab ? { tab: action.tab } : {});
      break;
    case "refresh":
      refreshSnapshot();
      break;
    case "theme":
      toggleTheme();
      break;
    case "pod":
      openPod(action.namespace, action.name, "overview");
      break;
    case "diagnose":
      openPod(action.namespace, action.name, "ai").then(() => runDiagnosis());
      break;
    default:
      break;
  }
}

function openCopilotPrompt(prompt) {
  if (state.drawer.open) closeDrawer();
  navigate("copilot");
  state.ai.draft = prompt;
  emit();
  requestAnimationFrame(() => {
    const input = document.getElementById("chat-input");
    if (input) {
      input.focus();
      autoGrow(input);
    }
  });
}

async function handleAction(el, event) {
  const action = el.dataset.action;
  const ns = el.dataset.namespace;
  const name = el.dataset.name;
  switch (action) {
    case "palette":
      openPalette();
      break;
    case "palette-close":
      closePalette();
      break;
    case "refresh":
      refreshSnapshot();
      break;
    case "retry-connect":
      connect();
      break;
    case "theme":
      toggleTheme();
      break;
    case "settings":
      navigate("settings", { tab: el.id === "provider-chip" ? "providers" : "connection" });
      break;
    case "update-open":
      openUpdateModal();
      break;
    case "update-check":
      checkForUpdates({ silent: false, force: true });
      break;
    case "update-release":
      openUpdateRelease();
      break;
    case "update-dismiss":
      dismissUpdate();
      break;
    case "open-url": {
      const url = el.dataset.url || "";
      if (!/^https?:\/\//i.test(url)) {
        addToast({ tone: "warning", title: "Link blocked", description: "Only http(s) links can be opened." });
        break;
      }
      bridge.openUrl(url).catch((err) =>
        addToast({ tone: "error", title: "Could not open link", description: err?.message || String(err) })
      );
      break;
    }
    case "open-pod":
      openPod(ns, name, el.dataset.tab || "overview");
      break;
    case "pod-logs":
      openPod(ns, name, "logs");
      break;
    case "pod-diagnose":
      openPod(ns, name, "ai").then(() => runDiagnosis());
      break;
    case "open-copilot":
      if (state.drawer.open) closeDrawer();
      navigate("copilot");
      break;
    case "open-copilot-workload":
      openCopilotPrompt(`Analyze the ${el.dataset.namespace || ""}/${name || "workload"} workload. Which pods are failing, what is the likely root cause, and what is the safest remediation?`);
      break;
    case "open-copilot-diagnosis":
      if (state.drawer.open) closeDrawer();
      navigate("copilot");
      break;
    case "open-settings-providers":
      navigate("settings", { tab: "providers" });
      break;
    case "open-workloads":
      state.filters = { ...state.filters, kind: "pods", namespace: "all", health: "all", search: "", page: 1 };
      navigate("workloads");
      break;
    case "open-events":
      state.filters = { ...state.filters, kind: "events", namespace: "all", health: "all", search: "", page: 1 };
      navigate("workloads");
      break;
    case "node-pods":
      state.filters = { ...state.filters, kind: "pods", namespace: "all", health: "all", search: el.dataset.node || "", page: 1 };
      navigate("workloads");
      break;
    case "workload-drill":
      state.filters = { ...state.filters, kind: "pods", namespace: "all", health: "all", search: name || "", page: 1 };
      navigate("workloads");
      break;
    case "workloads-kind":
      state.filters.kind = el.dataset.kind || "pods";
      state.filters.page = 1;
      if (state.filters.kind === "events") state.filters.health = "all";
      emit();
      break;
    case "workloads-page":
      state.filters.page = Number(el.dataset.page) || 1;
      emit();
      break;
    case "security-select":
      state.security.selected = name;
      emit();
      break;
    case "security-filter":
      state.security.filter = el.dataset.filter || "all";
      emit();
      break;
    case "security-refresh":
      loadSecurity({ force: true });
      break;
    case "security-ask":
      openCopilotPrompt(`Prioritize the vulnerability findings for workload ${name || "the cluster"}. Explain the highest-risk image, the exploitability, and the safest upgrade sequence.`);
      break;
    case "chat-send":
      sendChat();
      break;
    case "chat-new":
      state.ai.messages = [];
      state.ai.error = "";
      state.ai.draft = "";
      state.ai.streaming = false;
      state.ai.requestId = null;
      emit();
      requestAnimationFrame(() => document.getElementById("chat-input")?.focus());
      break;
    case "chat-suggestion":
      sendChat(el.dataset.prompt || "");
      break;
    case "drawer-close":
      closeDrawer();
      break;
    case "drawer-tab":
      setDrawerTab(el.dataset.tab || "overview");
      break;
    case "drawer-retry": {
      const key = state.drawer.key;
      if (key) {
        const [namespace, podName] = key.split("/");
        openPod(namespace, podName, state.drawer.tab || "overview");
      }
      break;
    }
    case "drawer-diagnose":
      setDrawerTab("ai");
      runDiagnosis();
      break;
    case "drawer-restart":
      restartSelected();
      break;
    case "drawer-delete":
      deleteSelected();
      break;
    case "suggestion-apply":
      applySuggestion(Number(el.dataset.index));
      break;
    case "diagnosis-apply":
      applyDiagnosisRec(Number(el.dataset.recIndex));
      break;
    case "diagnosis-raw": {
      const diagnosis = state.drawer.diagnosis || state.ai.diagnosis;
      if (diagnosis?.raw) {
        openInfo({
          title: "Raw model output",
          sub: "Unparsed response from the active provider.",
          iconName: "file",
          body: `<pre class="code-block" style="white-space:pre-wrap;max-height:52vh;overflow:auto">${escapeHtml(diagnosis.raw)}</pre>`,
        });
      }
      break;
    }
    case "log-previous":
      setLogPrevious(!state.drawer.logPrevious);
      break;
    case "log-refresh":
      state.drawer.logs = null;
      emit();
      loadLogs();
      break;
    case "log-copy":
      copyLogs();
      break;
    case "log-download":
      downloadLogs();
      break;
    case "copy": {
      const value = el.dataset.copy || "";
      copyText(value).then((ok) =>
        addToast({
          tone: ok ? "success" : "error",
          title: ok ? "Copied" : "Copy failed",
          description: ok ? "Copied to the clipboard." : "Clipboard access was denied.",
          timeout: 2200,
        })
      );
      break;
    }
    case "modal-close":
      closeModal();
      break;
    case "modal-confirm":
      confirmModal();
      break;
    case "toast-close":
      removeToast(el.dataset.id);
      break;
    case "settings-tab":
      collectSettings();
      state.settingsTab = el.dataset.tab || "connection";
      emit();
      if (state.settingsTab === "audit") refreshAudit();
      break;
    case "settings-toggle":
      toggleSettingsPath(el.dataset.path || "");
      break;
    case "settings-save":
      saveSettings();
      break;
    case "settings-save-connection":
      saveSettings({ toast: false }).then((saved) => {
        if (saved) connect();
      });
      break;
    case "settings-reload":
      reloadSettings();
      break;
    case "settings-reset-safety":
      resetSafety();
      break;
    case "audit-refresh":
      refreshAudit();
      break;
    case "provider-expand": {
      collectSettings();
      const kind = el.dataset.kind;
      state.settingsUi.expandedProvider = state.settingsUi.expandedProvider === kind ? null : kind;
      emit();
      break;
    }
    case "provider-toggle": {
      collectSettings();
      const provider = providerFor(el.dataset.kind);
      if (provider) {
        const nextEnabled = !provider.enabled;
        if (!nextEnabled && state.settings.activeProvider === provider.kind) {
          addToast({
            tone: "warning",
            title: "Active provider stays enabled",
            description: "Switch to another provider before disabling this one.",
            timeout: 3600,
          });
          return;
        }
        provider.enabled = nextEnabled;
        emit();
      }
      break;
    }
    case "provider-key-toggle": {
      const input = document.getElementById(`key-${el.dataset.kind}`);
      if (input) {
        input.type = input.type === "password" ? "text" : "password";
        el.innerHTML = icon(input.type === "password" ? "eye" : "lock");
      }
      break;
    }
    case "provider-save":
      saveProvider(el.dataset.kind, { toast: true });
      break;
    case "provider-test":
      testProvider(el.dataset.kind);
      break;
    case "provider-use": {
      const kind = el.dataset.kind;
      collectSettings();
      const provider = providerFor(kind);
      if (provider) {
        provider.enabled = true;
        state.settings.activeProvider = kind;
        state.settings.activeModel = provider.model;
        saveSettings({ toast: false }).then((saved) => {
          if (saved) addToast({ tone: "success", title: `${provider.label} is active`, description: provider.model, timeout: 3200 });
          emit();
        });
      }
      break;
    }
    case "provider-list-models":
      refreshModelLists();
      break;
    case "theme-set":
      collectSettings();
      toggleTheme(el.dataset.theme);
      break;
    case "density-set":
      collectSettings();
      setDensity(el.dataset.density || "comfortable");
      break;
    default:
      break;
  }
}

function handleChange(el) {
  const action = el.dataset.action;
  switch (action) {
    case "workloads-namespace":
      state.filters.namespace = el.value;
      state.filters.page = 1;
      emit();
      break;
    case "workloads-health":
      state.filters.health = el.value;
      state.filters.page = 1;
      emit();
      break;
    case "log-container":
      setLogContainer(el.value);
      break;
    default:
      break;
  }
}

function handleInput(el) {
  const action = el.dataset.action;
  switch (action) {
    case "workloads-search":
      state.filters.search = el.value;
      state.filters.page = 1;
      emit();
      break;
    case "security-search":
      state.security.search = el.value;
      emit();
      break;
    case "log-search":
      setLogSearch(el.value);
      break;
    case "chat-input":
      state.ai.draft = el.value;
      autoGrow(el);
      updateChatSend();
      break;
    default:
      break;
  }
}

function handleKeydown(event) {
  const mod = event.ctrlKey || event.metaKey;
  const target = event.target;
  const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);

  if (mod && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (state.palette.open) closePalette();
    else openPalette();
    return;
  }
  if (mod && event.key.toLowerCase() === "r") {
    event.preventDefault();
    refreshSnapshot();
    return;
  }
  if (event.key === "Escape") {
    const modal = document.getElementById("modal");
    if (modal && !modal.hidden) {
      closeModal();
      return;
    }
    if (state.palette.open) {
      closePalette();
      return;
    }
    if (state.drawer.open) {
      closeDrawer();
      return;
    }
  }
  if (target?.id === "chat-input" && event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChat();
    return;
  }
  if (!typing && event.key === "?") {
    event.preventDefault();
    openInfo({
      title: "Keyboard shortcuts",
      sub: "Move through the observatory without leaving the keyboard.",
      iconName: "command",
      body: `<div class="shortcut-list">
        <div class="shortcut-row"><span>Command palette</span><kbd>Ctrl K</kbd></div>
        <div class="shortcut-row"><span>Refresh snapshot</span><kbd>Ctrl R</kbd></div>
        <div class="shortcut-row"><span>Overview</span><kbd>G then O</kbd></div>
        <div class="shortcut-row"><span>Workloads</span><kbd>G then W</kbd></div>
        <div class="shortcut-row"><span>Nodes</span><kbd>G then N</kbd></div>
        <div class="shortcut-row"><span>Copilot</span><kbd>G then C</kbd></div>
        <div class="shortcut-row"><span>Security</span><kbd>G then S</kbd></div>
        <div class="shortcut-row"><span>Settings</span><kbd>G then ,</kbd></div>
      </div>`,
    });
    return;
  }
  if (!typing && event.key.toLowerCase() === "g") {
    gPrefixAt = Date.now();
    return;
  }
  if (!typing && Date.now() - gPrefixAt < 1200) {
    const map = { o: "overview", w: "workloads", n: "nodes", c: "copilot", s: "security", ",": "settings" };
    const route = map[event.key.toLowerCase()];
    if (route) {
      event.preventDefault();
      gPrefixAt = 0;
      navigate(route);
    }
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const windowButton = event.target.closest("[data-window]");
    if (windowButton) {
      event.preventDefault();
      const action = windowButton.dataset.window;
      if (action === "minimize") bridge.windowMinimize();
      else if (action === "maximize") bridge.windowToggleMaximize();
      else if (action === "close") bridge.windowClose();
      return;
    }

    const paletteItem = event.target.closest("[data-palette-index]");
    if (paletteItem) {
      event.preventDefault();
      paletteSelect(Number(paletteItem.dataset.paletteIndex));
      return;
    }

    const nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      if (state.drawer.open) closeDrawer();
      navigate(nav.dataset.nav);
      return;
    }

    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    event.preventDefault();
    handleAction(actionEl, event);
  });

  document.addEventListener("change", (event) => {
    const el = event.target.closest("[data-action]");
    if (el) handleChange(el);
  });

  document.addEventListener("input", (event) => {
    const el = event.target.closest("[data-action]");
    if (el) handleInput(el);
  });

  document.addEventListener("keydown", handleKeydown);

  const paletteInput = document.getElementById("palette-input");
  if (paletteInput) {
    paletteInput.addEventListener("input", () => {
      state.palette.query = paletteInput.value;
      state.palette.index = 0;
      renderPalette(state);
    });
    paletteInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        paletteMove(1);
        renderPalette(state);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        paletteMove(-1);
        renderPalette(state);
      } else if (event.key === "Enter") {
        event.preventDefault();
        paletteSelect(state.palette.index);
      }
    });
  }

  window.addEventListener("hashchange", () => {
    const parsed = parseHash();
    state.route = parsed.route;
    state.routeParams = parsed.params;
    if (parsed.route === "settings" && parsed.params.tab) state.settingsTab = parsed.params.tab;
    if (state.drawer.open) closeDrawer();
    emit();
  });

  window.addEventListener("kh:refresh", () => refreshSnapshot({ silent: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.connected) refreshSnapshot({ silent: true });
  });
}

function initRoute() {
  const parsed = parseHash();
  state.route = parsed.route;
  state.routeParams = parsed.params;
  if (parsed.route === "settings" && parsed.params.tab) state.settingsTab = parsed.params.tab;
}

async function boot() {
  applyPreferences();
  subscribe(scheduleRender);
  configurePalette(handlePaletteAction);
  bindEvents();
  initRoute();
  try {
    bootStatus("Reading local configuration");
    const data = await bridge.bootstrap();
    state.isTauri = bridge.isTauri;
    state.settings = data?.settings || state.settings;
    state.audit = data?.audit || [];
    state.appVersion = data?.appVersion || state.appVersion;
    state.platform = data?.platform || (state.isTauri ? "desktop" : "browser");
    state.settingsUi.expandedProvider = state.settings?.activeProvider || "ollama";
    state.theme = state.settings?.appearance?.theme || state.theme;
    state.density = state.settings?.appearance?.density || state.density;
    applyPreferences();
    state.booted = true;
    emit();
    if (data?.snapshot) applySnapshot(data.snapshot);
    bootStatus("Opening kubeconfig and probing the API server");
    await connect();
  } catch (err) {
    state.booted = true;
    state.connectionError = err?.message || String(err);
    state.connected = false;
    hideBoot();
    emit();
    addToast({ tone: "error", title: "Startup failed", description: state.connectionError, timeout: 8000 });
  }
  setTimeout(() => checkForUpdates({ silent: true }), 2200);
}

boot();
