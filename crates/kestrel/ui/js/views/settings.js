import { icon } from "../icons.js";
import {
  escapeHtml,
  fmtDateTime,
  fmtNumber,
  humanize,
  statusTone,
} from "../format.js";

const TABS = [
  ["connection", "Connection", "network"],
  ["providers", "AI providers", "sparkles"],
  ["safety", "Safety", "shield-check"],
  ["appearance", "Appearance", "sun"],
  ["audit", "Audit log", "logs"],
  ["about", "About", "info"],
];

const PROVIDER_MARK = {
  ollama: "OL",
  gemini: "G",
  openrouter: "OR",
  anthropic: "AN",
  githubCopilot: "GH",
};

const ACTION_LABEL = {
  restartWorkload: "Restart workload",
  deletePod: "Delete pod",
  patchImage: "Patch image",
  patchResources: "Patch resources",
  scaleWorkload: "Scale workload",
  rollbackDeployment: "Rollback deployment",
};

const PROVIDER_MODE = {
  ollama: "local",
  gemini: "cloud",
  openrouter: "gateway",
  anthropic: "cloud",
  githubCopilot: "copilot",
};

function settingsNav(state) {
  return `<nav class="settings-nav" aria-label="Settings sections">
    ${TABS.map(
      ([id, label, iconName]) =>
        `<button class="settings-nav__item${state.settingsTab === id ? " is-active" : ""}" data-action="settings-tab" data-tab="${id}">${icon(iconName)} ${label}</button>`
    ).join("")}
  </nav>`;
}

function connectionBanner(state) {
  const cluster = state.snapshot?.cluster;
  const connected = state.connected && cluster;
  return `<div class="connection-banner">
    <div class="connection-banner__mark">${icon(connected ? "shield-check" : "network")}</div>
    <div class="connection-banner__body">
      <div class="connection-banner__title">
        ${connected ? `Connected to ${escapeHtml(cluster.name)}` : state.connecting ? "Establishing connection…" : "Cluster is offline"}
        <span class="badge badge--dot" data-tone="${connected ? "success" : state.connecting ? "warning" : "critical"}">${connected ? "live" : state.connecting ? "connecting" : "offline"}</span>
      </div>
      <div class="connection-banner__meta">
        ${connected ? `${escapeHtml(cluster.context || "context")} · ${escapeHtml(cluster.server || "")} · ${cluster.latencyMs || 0} ms · ${escapeHtml(cluster.version || "")}` : escapeHtml(state.connectionError || "No cluster snapshot yet.")}
      </div>
    </div>
    <div class="endpoint-row"><span class="status-dot" data-status="${connected ? "connected" : state.connecting ? "connecting" : "error"}"></span>${connected ? "API server reachable" : "waiting"}</div>
  </div>`;
}

function field({ label, hint, input, wide = false }) {
  return `<div class="field${wide ? " field--wide" : ""}">
    <label class="label">${label}${hint ? `<small>${hint}</small>` : ""}</label>
    ${input}
  </div>`;
}

function connectionTab(state) {
  const settings = state.settings || {};
  return `<div class="settings-content">
    ${connectionBanner(state)}
    <section class="settings-section">
      <div class="settings-section__head">
        <div class="settings-section__title">${icon("network")} Kubernetes connection</div>
        <div class="settings-section__desc">The app reads a kubeconfig from disk and speaks directly to the API server. Credentials never leave this machine.</div>
      </div>
      <div class="settings-section__body">
        <div class="settings-row">
          <div class="settings-row__label"><strong>Kubeconfig</strong><small>Absolute path to the YAML file. Any local forwarding or proxy is outside the app; point the kubeconfig at the endpoint you want to use.</small></div>
          <div class="field">
            <input class="input mono" id="settings-kubeconfig" data-settings-field="kubeconfigPath" value="${escapeHtml(settings.kubeconfigPath || "")}" spellcheck="false" autocomplete="off" placeholder="C:\\Users\\you\\.kube\\config" />
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row__label"><strong>Context</strong><small>Leave blank to use the current context in the file.</small></div>
          <div class="field">
            <input class="input mono" data-settings-field="context" value="${escapeHtml(settings.context || "")}" spellcheck="false" autocomplete="off" placeholder="current context" />
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row__label"><strong>API endpoint</strong><small>Observed from the active kubeconfig after connecting.</small></div>
          <div class="endpoint-row" style="min-height:32px"><span class="status-dot" data-status="${state.connected ? "connected" : "error"}"></span>${escapeHtml(state.snapshot?.cluster?.server || "resolved from kubeconfig")}</div>
        </div>
        <div class="settings-row">
          <div class="settings-row__label"><strong>Actions</strong><small>Save the path first, then reconnect to probe the API server.</small></div>
          <div class="row">
            <button class="btn btn--primary" data-action="settings-save-connection" ${state.settingsUi?.connecting ? "disabled" : ""}>${icon(state.settingsUi?.connecting ? "rotate" : "refresh")} ${state.settingsUi?.connecting ? "Connecting…" : "Save & connect"}</button>
            <button class="btn btn--ghost" data-action="settings-save">${icon("check")} Save only</button>
            <button class="btn btn--ghost" data-action="refresh">${icon("rotate")} Refresh snapshot</button>
          </div>
        </div>
      </div>
    </section>
  </div>`;
}

function providerStatus(provider) {
  const status = provider.status || "unconfigured";
  const label = status === "ready" ? "ready" : status === "error" ? "error" : status === "testing" ? "testing" : "unconfigured";
  return `<span class="provider-status" data-status="${escapeHtml(status)}"><span class="status-dot" data-status="${status === "ready" ? "connected" : status === "error" ? "error" : status === "testing" ? "connecting" : "neutral"}"></span>${label}${provider.latencyMs ? ` · ${provider.latencyMs}ms` : ""}</span>`;
}

function providerCard(provider, state) {
  const active = state.settings?.activeProvider === provider.kind;
  const expanded = state.settingsUi?.expandedProvider === provider.kind;
  const testing = state.settingsUi?.testing === provider.kind;
  const models = provider.models || [];
  const needsKey = provider.kind !== "ollama";
  const placeholder = needsKey
    ? provider.apiKey
      ? "saved key — leave blank to keep"
      : "paste API key"
    : "not required for local Ollama";
  return `<article class="provider-card${active ? " is-active" : ""}">
    <div class="provider-card__head" data-action="provider-expand" data-kind="${escapeHtml(provider.kind)}">
      <span class="provider-logo" data-kind="${escapeHtml(provider.kind)}">${PROVIDER_MARK[provider.kind] || provider.label.slice(0, 2).toUpperCase()}</span>
      <div class="provider-card__title">
        <div class="provider-card__name">${escapeHtml(provider.label)} ${active ? `<span class="badge" data-tone="success">active</span>` : ""}</div>
        <div class="provider-card__sub">${escapeHtml(PROVIDER_MODE[provider.kind] || "provider")} · ${escapeHtml(provider.model || "no model")}</div>
      </div>
      <div class="provider-card__end">
        ${providerStatus(provider)}
        ${icon(expanded ? "chevron-down" : "chevron-right")}
      </div>
    </div>
    ${
      expanded
        ? `<div class="provider-card__body">
            ${field({ label: "Base URL", hint: "OpenAI-compatible or native API root", wide: true, input: `<input class="input mono" data-provider-kind="${escapeHtml(provider.kind)}" data-provider-field="baseUrl" value="${escapeHtml(provider.baseUrl || "")}" spellcheck="false" />` })}
            ${field({
              label: "API key",
              hint: needsKey ? "stored locally in settings.json" : "Ollama does not require a key",
              wide: true,
              input: `<div class="input-with-action"><input class="input mono" id="key-${escapeHtml(provider.kind)}" type="password" data-provider-kind="${escapeHtml(provider.kind)}" data-provider-field="apiKey" data-secret="1" value="" placeholder="${escapeHtml(placeholder)}" spellcheck="false" autocomplete="off" /><button class="input-action" data-action="provider-key-toggle" data-kind="${escapeHtml(provider.kind)}" title="Show or hide key">${icon("eye")}</button></div>`,
            })}
            ${field({
              label: "Model",
              hint: models.length ? `${models.length} known models` : "type any model id",
              input: `<input class="input mono" data-provider-kind="${escapeHtml(provider.kind)}" data-provider-field="model" value="${escapeHtml(provider.model || "")}" list="models-${escapeHtml(provider.kind)}" spellcheck="false" /><datalist id="models-${escapeHtml(provider.kind)}">${models.map((m) => `<option value="${escapeHtml(m)}"></option>`).join("")}</datalist>`,
            })}
            ${provider.kind === "githubCopilot" ? field({
              label: "Mode",
              hint: "Copilot API or GitHub Models fallback",
              input: `<select class="select" data-provider-kind="${escapeHtml(provider.kind)}" data-provider-field="mode"><option value="auto"${provider.mode !== "models" && provider.mode !== "github-models" ? " selected" : ""}>Auto (Copilot → GitHub Models)</option><option value="models"${provider.mode === "models" || provider.mode === "github-models" ? " selected" : ""}>GitHub Models only</option></select>`,
            }) : ""}
            ${field({
              label: "Enabled",
              hint: "Include in the provider switcher",
              input: `<div class="row"><button class="toggle${provider.enabled ? " is-on" : ""}" data-action="provider-toggle" data-kind="${escapeHtml(provider.kind)}" role="switch" aria-checked="${Boolean(provider.enabled)}"></button><span class="hint">${provider.enabled ? "enabled" : "disabled"}</span></div>`,
            })}
          </div>
          <div class="provider-card__foot">
            <span>${escapeHtml(provider.hint || "")}${provider.docsUrl ? ` · <button class="link-button" data-action="open-url" data-url="${escapeHtml(provider.docsUrl)}">docs ${icon("external")}</button>` : ""}</span>
            <span class="row">
              <button class="btn btn--sm btn--ghost" data-action="provider-test" data-kind="${escapeHtml(provider.kind)}" ${testing ? "disabled" : ""}>${testing ? `<span class="spinner"></span> Testing` : `${icon("zap")} Test`}</button>
              <button class="btn btn--sm" data-action="provider-save" data-kind="${escapeHtml(provider.kind)}">${icon("check")} Save</button>
              ${active ? "" : `<button class="btn btn--sm btn--primary" data-action="provider-use" data-kind="${escapeHtml(provider.kind)}">${icon("play")} Use</button>`}
            </span>
          </div>`
        : ""
    }
  </article>`;
}

function providersTab(state) {
  const providers = state.settings?.providers || [];
  const active = providers.find((p) => p.kind === state.settings?.activeProvider);
  return `<div class="settings-content">
    <div class="connection-banner">
      <div class="connection-banner__mark">${icon("sparkles")}</div>
      <div class="connection-banner__body">
        <div class="connection-banner__title">${escapeHtml(active?.label || "No active provider")} <span class="badge" data-tone="${active?.status === "ready" ? "success" : "warning"}">${active?.status || "unconfigured"}</span></div>
        <div class="connection-banner__meta">${escapeHtml(active?.model || "select a provider")} · ${active?.latencyMs ? `${active.latencyMs} ms` : "not tested"} · keys are stored locally</div>
      </div>
      <div class="endpoint-row"><span class="status-dot" data-status="${active?.status === "ready" ? "connected" : "warning"}"></span>${providers.filter((p) => p.enabled).length} enabled</div>
    </div>
    <section class="settings-section">
      <div class="settings-section__head">
        <div class="settings-section__title">${icon("sparkles")} Providers</div>
        <div class="settings-section__desc">Bring your own model. Ollama runs locally; the cloud providers use keys you supply. Testing a provider lists its models and measures latency.</div>
      </div>
      <div class="settings-section__body">
        <div class="provider-grid">${providers.map((p) => providerCard(p, state)).join("")}</div>
      </div>
    </section>
    <section class="settings-section">
      <div class="settings-section__head">
        <div class="settings-section__title">${icon("shield-check")} How requests are handled</div>
      </div>
      <div class="settings-section__body">
        <div class="risk-banner">${icon("lock")}<div>Diagnosis prompts contain pod status, conditions, warning events, and a bounded log excerpt. API keys are sent only to the selected provider over TLS. Nothing is written to the cluster without approval.</div></div>
        <div class="row" style="margin-top:12px">
          <button class="btn btn--ghost" data-action="provider-list-models">${icon("refresh")} Refresh model lists</button>
          <button class="btn btn--ghost" data-action="open-copilot">${icon("sparkles")} Test in Copilot</button>
        </div>
      </div>
    </section>
  </div>`;
}

function toggleRow({ title, desc, path, value, iconName = "shield-check" }) {
  return `<div class="toggle-row">
    <span class="toggle-row__icon">${icon(iconName)}</span>
    <div class="toggle-row__text"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(desc)}</small></div>
    <button class="toggle${value ? " is-on" : ""}" data-action="settings-toggle" data-path="${escapeHtml(path)}" role="switch" aria-checked="${Boolean(value)}"></button>
  </div>`;
}

function safetyTab(state) {
  const safety = state.settings?.safety || {};
  return `<div class="settings-content">
    <section class="settings-section">
      <div class="settings-section__head">
        <div class="settings-section__title">${icon("shield-check")} Guardrails</div>
        <div class="settings-section__desc">The backend enforces these limits independently of the UI. A provider cannot talk the app into an unsafe mutation.</div>
      </div>
      <div class="settings-section__body">
        ${toggleRow({ title: "Require confirmation", desc: "Every mutation must be confirmed in a modal with the exact action payload.", path: "safety.requireConfirmation", value: safety.requireConfirmation, iconName: "check" })}
        ${toggleRow({ title: "Allow destructive actions", desc: "Permit delete-pod and other irreversible operations after typed confirmation.", path: "safety.allowDestructive", value: safety.allowDestructive, iconName: "trash" })}
        ${toggleRow({ title: "Redact log contents", desc: "Strip obvious secrets and tokens before sending logs to a model.", path: "safety.redactLogs", value: safety.redactLogs, iconName: "lock" })}
        <div class="settings-row" style="margin-top:12px">
          <div class="settings-row__label"><strong>Protected namespaces</strong><small>Comma or newline separated. Mutations are blocked in these namespaces.</small></div>
          <div class="field">
            <textarea class="textarea mono" rows="3" data-settings-field="safety.protectedNamespaces">${escapeHtml((safety.protectedNamespaces || []).join("\n"))}</textarea>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row__label"><strong>OOM patch limit</strong><small>Maximum memory increase per container when applying a resource patch.</small></div>
          <div class="field"><input class="input mono" type="number" min="1" max="32" data-settings-field="safety.maxOomPatchCount" value="${Number(safety.maxOomPatchCount) || 3}" /></div>
        </div>
        <div class="settings-row">
          <div class="settings-row__label"><strong>Memory ceiling</strong><small>Refuse patches above this many MiB for a single container.</small></div>
          <div class="field"><input class="input mono" type="number" min="64" max="65536" data-settings-field="safety.maxMemoryMi" value="${Number(safety.maxMemoryMi) || 1024}" /></div>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn--primary" data-action="settings-save">${icon("check")} Save guardrails</button>
          <button class="btn btn--ghost" data-action="settings-reset-safety">${icon("rotate")} Reset defaults</button>
        </div>
      </div>
    </section>
    <div class="risk-banner" data-tone="warning">${icon("alert")}<div><strong>Protected namespaces are enforced twice.</strong> The UI hides actions, and the Rust backend rejects mutations in protected namespaces even if a request is crafted manually.</div></div>
  </div>`;
}

function appearanceTab(state) {
  const appearance = state.settings?.appearance || {};
  const theme = state.theme || appearance.theme || "dark";
  const density = state.density || appearance.density || "comfortable";
  return `<div class="settings-content">
    <section class="settings-section">
      <div class="settings-section__head">
        <div class="settings-section__title">${icon("sun")} Interface</div>
        <div class="settings-section__desc">The observatory is designed for long sessions: low-glare surfaces, editorial type, and restrained motion.</div>
      </div>
      <div class="settings-section__body">
        <div class="settings-row">
          <div class="settings-row__label"><strong>Theme</strong><small>Obsidian is the default. Daylight is tuned for bright rooms.</small></div>
          <div class="segmented">
            <button class="${theme === "dark" ? "is-active" : ""}" data-action="theme-set" data-theme="dark">${icon("moon")} Obsidian</button>
            <button class="${theme === "light" ? "is-active" : ""}" data-action="theme-set" data-theme="light">${icon("sun")} Daylight</button>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row__label"><strong>Density</strong><small>Compact fits more rows on a laptop screen.</small></div>
          <div class="segmented">
            <button class="${density === "comfortable" ? "is-active" : ""}" data-action="density-set" data-density="comfortable">Comfortable</button>
            <button class="${density === "compact" ? "is-active" : ""}" data-action="density-set" data-density="compact">Compact</button>
          </div>
        </div>
        ${toggleRow({ title: "Reduce motion", desc: "Disable ambient pulses, chart sweeps, and entrance animations.", path: "appearance.reduceMotion", value: appearance.reduceMotion, iconName: "pause" })}
        ${toggleRow({ title: "Show seconds", desc: "Use second-level timestamps in logs and event streams.", path: "appearance.showSeconds", value: appearance.showSeconds, iconName: "clock" })}
      </div>
    </section>
    <section class="settings-section">
      <div class="settings-section__head">
        <div class="settings-section__title">${icon("eye")} Preview</div>
        <div class="settings-section__desc">A live sample of the current palette and density.</div>
      </div>
      <div class="settings-section__body">
        <div class="appearance-preview" data-density="${escapeHtml(density)}">
          <div class="appearance-preview__bar"><span class="health-dot" data-health="healthy"></span><strong>payment-api-7d9c8f6b5-2xk4q</strong><span class="badge badge--dot" data-tone="critical">CrashLoopBackOff</span><span class="spacer"></span><span class="mono faint">12s ago</span></div>
          <div class="appearance-preview__row"><span class="mono faint">RESTARTS</span><strong>17</strong><span class="bar"><i data-tone="critical" style="width:84%"></i></span><span class="badge" data-tone="warning">OOMKilled</span></div>
          <div class="appearance-preview__row"><span class="mono faint">NODE</span><strong>shinjiru</strong><span class="spacer"></span><span class="mono faint">k3s v1.35.5</span></div>
        </div>
        <div class="row" style="margin-top:14px"><button class="btn btn--primary" data-action="settings-save">${icon("check")} Save appearance</button></div>
      </div>
    </section>
  </div>`;
}

function auditTab(state) {
  const audit = state.audit || [];
  return `<div class="settings-content">
    <section class="settings-section">
      <div class="settings-section__head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <div class="settings-section__title">${icon("logs")} Audit log</div>
          <div class="settings-section__desc">Every requested mutation, its target, and whether it was applied, blocked, or failed. Stored locally; capped at 250 entries.</div>
        </div>
        <button class="btn btn--sm btn--ghost" data-action="audit-refresh">${icon("refresh")} Refresh</button>
      </div>
      <div class="settings-section__body" style="padding:0">
        ${
          audit.length
            ? `<div class="audit-scroll"><table class="audit-table">
                <thead><tr><th>Time</th><th>Action</th><th>Target</th><th>Status</th><th>Detail</th></tr></thead>
                <tbody>${audit
                  .map(
                    (entry) => `<tr>
                      <td>${fmtDateTime(entry.timestamp)}</td>
                      <td>${escapeHtml(ACTION_LABEL[entry.action] || humanize(entry.action))}</td>
                      <td>${escapeHtml(entry.target)}</td>
                      <td><span class="audit-status" data-status="${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span></td>
                      <td title="${escapeHtml(entry.detail)}">${escapeHtml(entry.detail)}</td>
                    </tr>`
                  )
                  .join("")}</tbody>
              </table></div>`
            : `<div class="empty" style="min-height:260px"><div class="empty__icon">${icon("logs")}</div><div class="empty__title">No mutations yet</div><div class="empty__desc">When you approve a remediation, the exact action and its outcome appear here. Nothing has been changed in this session.</div></div>`
        }
      </div>
      <div class="panel__foot row row--between">
        <span class="mono faint">${audit.length} ${audit.length === 1 ? "entry" : "entries"}</span>
        <span class="mono faint">local audit · approval-gated</span>
      </div>
    </section>
    <div class="risk-banner">${icon("info")}<div>The audit log is a local record, not a Kubernetes audit trail. The API server's own audit policy remains the authoritative source.</div></div>
  </div>`;
}

function aboutTab(state) {
  const settings = state.settings || {};
  const shortcuts = [
    ["Ctrl K", "Command palette"],
    ["Ctrl R", "Refresh snapshot"],
    ["Esc", "Close overlay"],
    ["G then O", "Go to overview"],
    ["G then W", "Go to workloads"],
    ["?", "Keyboard help"],
  ];
  return `<div class="settings-content">
    <section class="settings-section">
      <div class="settings-section__head">
        <div class="settings-section__title">${icon("logo")} Kestrel</div>
        <div class="settings-section__desc">Cluster intelligence with a human in the loop. Rust + Tauri 2 + a static, hand-built interface.</div>
      </div>
      <div class="settings-section__body">
        <div class="about-grid">
          <div class="about-stat"><span>Version</span><strong>${escapeHtml(state.appVersion || "0.1.0")}</strong></div>
          <div class="about-stat"><span>Runtime</span><strong>${state.isTauri ? "Tauri 2 · MSVC" : "Browser preview"}</strong></div>
          <div class="about-stat"><span>Providers</span><strong>${(settings.providers || []).length} adapters</strong></div>
          <div class="about-stat"><span>Cluster</span><strong>${escapeHtml(state.snapshot?.cluster?.name || "not connected")}</strong></div>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn--ghost" data-action="open-url" data-url="https://github.com/Shinjiru-stack/kestrel">${icon("github")} Repository</button>
          <button class="btn btn--ghost" data-action="open-url" data-url="https://kubernetes.io/docs/">${icon("external")} Kubernetes docs</button>
          <button class="btn btn--ghost" data-action="open-url" data-url="https://ollama.com">${icon("sparkles")} Ollama</button>
        </div>
      </div>
    </section>
    <section class="settings-section">
      <div class="settings-section__head"><div class="settings-section__title">${icon("command")} Keyboard</div></div>
      <div class="settings-section__body">
        <div class="shortcut-list">
          ${shortcuts.map(([key, label]) => `<div class="shortcut-row"><span>${escapeHtml(label)}</span><kbd>${escapeHtml(key)}</kbd></div>`).join("")}
        </div>
      </div>
    </section>
    <section class="settings-section">
      <div class="settings-section__head"><div class="settings-section__title">${icon("shield")} Principles</div></div>
      <div class="settings-section__body">
        <div class="principle-list">
          <div class="principle"><span>01</span><div><strong>Evidence before action.</strong> Diagnostics cite pod conditions, events, and log lines. The model is never the only witness.</div></div>
          <div class="principle"><span>02</span><div><strong>Approval is a feature.</strong> Every mutation shows its exact payload and blast radius before it runs.</div></div>
          <div class="principle"><span>03</span><div><strong>Local first.</strong> Settings, keys, and the audit trail stay on this machine. Ollama is a first-class provider.</div></div>
          <div class="principle"><span>04</span><div><strong>No silent automation.</strong> Kestrel suggests; you decide. There is no background mutation loop.</div></div>
        </div>
      </div>
    </section>
  </div>`;
}

export function renderSettings(state) {
  const tab = state.settingsTab || "connection";
  const content =
    tab === "providers"
      ? providersTab(state)
      : tab === "safety"
        ? safetyTab(state)
        : tab === "appearance"
          ? appearanceTab(state)
          : tab === "audit"
            ? auditTab(state)
            : tab === "about"
              ? aboutTab(state)
              : connectionTab(state);

  return `<div class="page-head">
    <div class="page-head__main">
      <div class="page-head__eyebrow"><span class="status-dot" data-status="${state.connected ? "connected" : "connecting"}"></span><span class="eyebrow">Control · local configuration</span></div>
      <h1 class="page-title">Settings</h1>
      <p class="page-desc">Connection, providers, guardrails, and the local audit trail. Changes are saved to this machine only.</p>
    </div>
    <div class="page-head__actions">
      ${state.settingsUi?.saving ? `<span class="mono faint">saving…</span>` : `<span class="mono faint">settings.json</span>`}
      <button class="btn btn--ghost" data-action="settings-reload">${icon("rotate")} Reload</button>
    </div>
  </div>
  <div class="settings-layout">
    ${settingsNav(state)}
    ${content}
  </div>`;
}
