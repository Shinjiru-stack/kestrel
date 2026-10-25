/* Bridge between the static UI and either Tauri commands or the preview mock. */

import { mock } from "./mock.js";

const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
export const isTauri = Boolean(tauri?.core?.invoke);
const invoke = tauri?.core?.invoke;
const listen = tauri?.event?.listen;
const appWindow = tauri?.window?.getCurrentWindow?.() || null;

function requireTauri(name) {
  if (!isTauri) throw new Error(`${name} is only available in the desktop app.`);
}

async function call(command, args = {}) {
  requireTauri(command);
  return invoke(command, args);
}

export const bridge = {
  isTauri,

  async bootstrap() {
    if (!isTauri) return mock.bootstrap();
    return call("get_bootstrap");
  },

  async connectCluster({ kubeconfigPath, context } = {}) {
    if (!isTauri) return mock.connect();
    return call("connect_cluster", { kubeconfigPath, context });
  },

  async refreshSnapshot() {
    if (!isTauri) return mock.snapshot();
    return call("refresh_snapshot");
  },

  async getPodDetail(namespace, name) {
    if (!isTauri) return mock.podDetail(namespace, name);
    return call("get_pod_detail", { namespace, name });
  },

  async getLogs(namespace, name, container, tail = 200, previous = false) {
    if (!isTauri) return mock.logs(namespace, name, container, tail, previous);
    return call("get_logs", { namespace, name, container, tail, previous });
  },

  async getSecurityReports() {
    if (!isTauri) return mock.securityReports();
    return call("get_security_reports");
  },

  async diagnosePod(namespace, name, container = "") {
    if (!isTauri) return mock.diagnose(namespace, name);
    return call("diagnose_pod", { namespace, name, container });
  },

  async runAction(action) {
    if (!isTauri) return mock.runAction(action);
    return call("run_action", { action });
  },

  async saveSettings(settings) {
    if (!isTauri) return mock.saveSettings(settings);
    return call("save_settings", { settings });
  },

  async testProvider(kind) {
    if (!isTauri) return mock.testProvider(kind);
    return call("test_provider", { kind });
  },

  async listModels(kind) {
    if (!isTauri) return mock.listModels(kind);
    return call("list_models", { kind });
  },

  async getAudit() {
    if (!isTauri) return mock.audit();
    return call("get_audit");
  },

  async openUrl(url) {
    if (!isTauri) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    return call("open_url", { url });
  },

  onSnapshot(callback) {
    if (!isTauri) return mock.subscribe(callback);
    let disposed = false;
    let unlisten = null;
    listen("cluster://snapshot", (event) => {
      if (!disposed) callback(event.payload);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  },

  onStatus(callback) {
    if (!isTauri) return () => {};
    let disposed = false;
    let unlisten = null;
    listen("cluster://status", (event) => {
      if (!disposed) callback(event.payload);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  },

  async chat(messages, context, onDelta) {
    if (!isTauri) {
      return mock.chat(messages, context, onDelta);
    }
    const requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let disposed = false;
    let unlisten = null;
    const ready = listen("ai://delta", (event) => {
      if (disposed) return;
      if (event.payload?.requestId !== requestId) return;
      onDelta?.(event.payload.delta || "");
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    try {
      await ready;
      const response = await call("chat", { requestId, messages, context });
      return response;
    } finally {
      disposed = true;
      if (unlisten) unlisten();
    }
  },

  async windowMinimize() {
    if (appWindow) await appWindow.minimize();
  },

  async windowToggleMaximize() {
    if (!appWindow) return;
    if (await appWindow.isMaximized()) await appWindow.unmaximize();
    else await appWindow.maximize();
  },

  async windowClose() {
    if (appWindow) await appWindow.close();
  },

  async windowIsMaximized() {
    if (!appWindow) return false;
    return appWindow.isMaximized();
  },

  async startDragging() {
    if (appWindow) await appWindow.startDragging();
  },
};
