/* Tiny observable store. Views subscribe to changes; main.js orchestrates. */

const listeners = new Set();

export const state = {
  booted: false,
  connected: false,
  connecting: false,
  connectionError: "",
  snapshot: null,
  history: [],
  settings: null,
  audit: [],
  route: "overview",
  routeParams: {},
  selectedPodKey: null,
  drawer: {
    open: false,
    tab: "overview",
    key: null,
    detail: null,
    logs: null,
    logsLoading: false,
    loading: false,
    error: "",
    logContainer: "",
    logPrevious: false,
    logSearch: "",
    diagnosis: null,
    diagnosing: false,
    diagnosisError: "",
  },
  filters: {
    kind: "pods",
    namespace: "all",
    health: "all",
    search: "",
    page: 1,
  },
  palette: {
    open: false,
    query: "",
    index: 0,
  },
  settingsTab: "connection",
  settingsUi: {
    expandedProvider: "ollama",
    saving: false,
    testing: "",
    connecting: false,
  },
  security: {
    reports: [],
    loading: false,
    loaded: false,
    error: "",
    filter: "all",
    search: "",
    selected: null,
  },
  ai: {
    messages: [],
    streaming: false,
    requestId: null,
    diagnosis: null,
    diagnoses: [],
    error: "",
    model: "",
    draft: "",
  },
  toasts: [],
  theme: localStorage.getItem("kh-theme") || "dark",
  density: localStorage.getItem("kh-density") || "comfortable",
  lastUpdated: null,
  isTauri: false,
  appVersion: "0.1.0",
};

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  for (const fn of [...listeners]) {
    try {
      fn(state);
    } catch (err) {
      console.error("store listener failed", err);
    }
  }
}

export function setState(patch, { silent = false } = {}) {
  if (typeof patch === "function") {
    patch = patch(state);
  }
  Object.assign(state, patch);
  if (!silent) emit();
}

export function patchState(path, value, options) {
  const keys = path.split(".");
  let target = state;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!target[key] || typeof target[key] !== "object") target[key] = {};
    target = target[key];
  }
  target[keys[keys.length - 1]] = value;
  if (!options?.silent) emit();
}

export function resetDrawer() {
  state.drawer = {
    open: false,
    tab: "overview",
    key: null,
    detail: null,
    logs: null,
    logsLoading: false,
    loading: false,
    error: "",
    logContainer: "",
    logPrevious: false,
    logSearch: "",
    diagnosis: null,
    diagnosing: false,
    diagnosisError: "",
  };
}

export function addToast(toast) {
  const id = toast.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const entry = {
    id,
    tone: toast.tone || "info",
    title: toast.title || "",
    description: toast.description || "",
    timeout: toast.timeout ?? 5200,
  };
  state.toasts = [...state.toasts, entry].slice(-5);
  emit();
  if (entry.timeout > 0) {
    setTimeout(() => removeToast(id), entry.timeout);
  }
  return id;
}

export function removeToast(id) {
  state.toasts = state.toasts.filter((t) => t.id !== id);
  emit();
}
