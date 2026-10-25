import { icon } from "../icons.js";
import { escapeHtml, fmtAge, fmtTime, markdownToHtml, severityTone } from "../format.js";

function suggestions(state) {
  const pods = state.snapshot?.pods || [];
  const top = pods.find((p) => p.health === "failed") || pods.find((p) => p.health === "warning") || null;
  const target = top ? `${top.namespace}/${top.name}` : null;
  return [
    "Triage the failing workloads and rank them by blast radius.",
    target ? `Diagnose ${target} and cite the evidence behind each finding.` : "Why is the highest-restart pod crash-looping?",
    target ? `Draft a safe remediation plan for ${target}.` : "Draft a safe remediation plan for the top failing workload.",
    "Summarize the cluster's security exposure.",
    "Which node is closest to pressure, and what should I do?",
  ];
}

const PROMPTS = [
  { icon: "alert", label: "Triage failing workloads", prompt: "Triage the failing workloads. Rank them by blast radius and tell me which one to fix first." },
  { icon: "memory", label: "Explain resource pressure", prompt: "Explain the current CPU and memory pressure across nodes, and identify the pods most likely to be evicted." },
  { icon: "shield", label: "Security posture review", prompt: "Review the vulnerability reports and summarize the highest-risk images, with a prioritized upgrade plan." },
  { icon: "wand", label: "Draft a remediation", prompt: "Draft an approval-gated remediation plan for the highest-severity pod failure. Include the exact action and rollback." },
  { icon: "logs", label: "Read logs like an SRE", prompt: "Walk through the recent logs of the selected pod and identify the earliest causal error, not just the loudest one." },
];

function providerFor(state) {
  return (state.settings?.providers || []).find((p) => p.kind === state.settings?.activeProvider) || null;
}

function contextPod(state) {
  if (!state.selectedPodKey) return null;
  const [namespace, name] = state.selectedPodKey.split("/");
  return (state.snapshot?.pods || []).find((p) => p.namespace === namespace && p.name === name) || null;
}

function messageHtml(message, state) {
  const assistant = message.role === "assistant";
  const streaming = assistant && state.ai.streaming && message.id === state.ai.requestId;
  const content = assistant ? markdownToHtml(message.content || "") : escapeHtml(message.content || "").replace(/\n/g, "<br>");
  return `<div class="chat-msg ${assistant ? "chat-msg--assistant" : "chat-msg--user"}">
    <div class="chat-msg__avatar">${assistant ? icon("sparkles") : "YOU"}</div>
    <div class="chat-msg__body">
      <div class="chat-msg__meta">
        <span>${assistant ? "COPILOT" : "YOU"}</span>
        ${assistant ? `<span>· ${escapeHtml(message.model || state.settings?.activeModel || "model")}</span>` : ""}
        <span>· ${fmtTime(message.at)}</span>
        ${assistant && message.usage ? `<span>· ${message.usage.outputTokens || 0} tokens</span>` : ""}
      </div>
      <div class="chat-bubble">
        ${content || (streaming ? `<span class="typing"><i></i><i></i><i></i></span>` : "")}
        ${streaming && content ? `<span class="chat-cursor"></span>` : ""}
      </div>
    </div>
  </div>`;
}

function emptyChat(state) {
  return `<div class="chat-empty">
    <div class="chat-empty__mark">${icon("sparkles")}</div>
    <h3>Ask the cluster a question.</h3>
    <p>I can correlate pod status, conditions, warning events, and recent logs. I will not mutate anything without your explicit approval.</p>
    <div class="chat-suggestions">
      ${suggestions(state).map((s) => `<button class="chat-suggestion" data-action="chat-suggestion" data-prompt="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("")}
    </div>
  </div>`;
}

function aside(state) {
  const pod = contextPod(state);
  const provider = providerFor(state);
  const diagnoses = state.ai.diagnoses || [];
  return `<aside class="copilot-aside">
    <div class="aside-card">
      <div class="aside-card__title">${icon("cube")} Context</div>
      ${
        pod
          ? `<div class="context-pod">
              <div class="context-pod__name">${escapeHtml(pod.name)}</div>
              <div class="context-pod__meta"><span class="health-dot" data-health="${escapeHtml(pod.health)}"></span><span>${escapeHtml(pod.namespace)}</span><span>·</span><span>${escapeHtml(pod.status || pod.phase)}</span></div>
              <div class="context-pod__meta" style="margin-top:5px"><span>${pod.restarts} restarts</span><span>·</span><span>${fmtAge(pod.ageSeconds)} old</span></div>
            </div>`
          : `<div class="context-pod"><div class="context-pod__name">Whole cluster</div><div class="context-pod__meta"><span class="status-dot" data-status="${state.connected ? "connected" : "connecting"}"></span><span>${escapeHtml(state.snapshot?.cluster.name || "not connected")}</span></div><div class="context-pod__meta" style="margin-top:5px"><span>${state.snapshot?.pods?.length || 0} pods · ${state.snapshot?.nodes?.length || 0} nodes</span></div></div>`
      }
      <div class="hint" style="margin-top:7px">${pod ? "Select a different pod from Workloads to change context." : "Select a pod in Workloads to focus the Copilot on one workload."}</div>
    </div>

    <div class="aside-card">
      <div class="aside-card__title">${icon("zap")} Prompt library</div>
      <div class="prompt-list">
        ${PROMPTS.map((p) => `<button class="prompt-item" data-action="chat-suggestion" data-prompt="${escapeHtml(p.prompt)}">${icon(p.icon)} ${escapeHtml(p.label)}</button>`).join("")}
      </div>
    </div>

    <div class="aside-card">
      <div class="aside-card__title">${icon("wand")} Recent diagnoses</div>
      ${
        diagnoses.length
          ? diagnoses
              .slice(0, 3)
              .map(
                (d) => `<div class="diagnosis-mini">
                  <div class="diagnosis-mini__head">
                    <span class="badge badge--dot" data-tone="${severityTone(d.severity)}">${escapeHtml(d.severity)}</span>
                    <span class="diagnosis-mini__title">${escapeHtml(d.name || "Pod")}</span>
                  </div>
                  <div class="diagnosis-mini__summary">${escapeHtml(d.summary || "")}</div>
                </div>`
              )
              .join("")
          : `<div class="hint">No diagnoses in this session. Open a pod and run a diagnosis to see it here.</div>`
      }
    </div>

    <div class="aside-card">
      <div class="aside-card__title">${icon("shield-check")} Guardrails</div>
      <div class="toggle-row" style="padding-top:0"><div class="toggle-row__text"><strong>Approval required</strong><small>Every mutation opens a confirmation.</small></div><span class="toggle is-on" aria-hidden="true"></span></div>
      <div class="toggle-row"><div class="toggle-row__text"><strong>Protected namespaces</strong><small>${escapeHtml((state.settings?.safety?.protectedNamespaces || []).join(", ") || "kube-system")}</small></div><span class="toggle is-on" aria-hidden="true"></span></div>
      <div class="toggle-row" style="border-bottom:0"><div class="toggle-row__text"><strong>Provider</strong><small>${escapeHtml(provider?.label || "Not configured")} · ${escapeHtml(provider?.model || state.settings?.activeModel || "no model")}</small></div><span class="status-dot" data-status="${provider?.status === "ready" ? "connected" : provider?.status === "error" ? "error" : "warning"}"></span></div>
    </div>
  </aside>`;
}

export function renderCopilot(state) {
  const provider = providerFor(state);
  const pod = contextPod(state);
  const messages = state.ai.messages || [];
  const streaming = state.ai.streaming;
  return `<div class="page-head">
    <div class="page-head__main">
      <div class="page-head__eyebrow"><span class="status-dot" data-status="${state.connected ? "connected" : "connecting"}"></span><span class="eyebrow">Intelligence · reasoning surface</span></div>
      <h1 class="page-title">Cluster Copilot</h1>
      <p class="page-desc">Evidence-grounded diagnosis across ${state.snapshot?.pods?.length || 0} pods and ${state.snapshot?.nodes?.length || 0} nodes. ${pod ? `Focused on ${pod.namespace}/${pod.name}.` : "No pod context selected."}</p>
    </div>
    <div class="page-head__actions">
      <button class="btn btn--ghost" data-action="chat-new">${icon("plus")} New thread</button>
      <button class="btn btn--ghost" data-action="open-settings-providers">${icon("settings")} Provider</button>
    </div>
  </div>

  <div class="copilot">
    <section class="panel chat-panel">
      <div class="chat-head">
        <div class="chat-head__mark">${icon("sparkles")}</div>
        <div class="chat-head__text">
          <div class="chat-head__title">Kestrel Copilot <span class="badge" data-tone="${provider?.status === "ready" ? "success" : "warning"}">${escapeHtml(provider?.label || "No provider")}</span></div>
          <div class="chat-head__sub">${escapeHtml(provider?.model || state.settings?.activeModel || "select a provider")} · ${streaming ? "streaming" : "ready"} · approval-gated actions</div>
        </div>
        <span class="pulse-line">${streaming ? "THINKING" : "LIVE"}</span>
      </div>
      <div class="chat-messages" id="chat-messages">
        ${messages.length ? messages.map((m) => messageHtml(m, state)).join("") : emptyChat(state)}
        ${state.ai.error ? `<div class="risk-banner" data-tone="danger" style="margin:0 18px">${icon("alert")}<div>${escapeHtml(state.ai.error)}</div></div>` : ""}
      </div>
      <div class="chat-composer">
        <div class="chat-input-wrap">
          <textarea id="chat-input" data-action="chat-input" rows="1" placeholder="Ask about a failure, a node, a security finding, or a remediation plan…" ${streaming ? "disabled" : ""}>${escapeHtml(state.ai.draft || "")}</textarea>
          <button class="chat-send" data-action="chat-send" ${streaming || !(state.ai.draft || "").trim() ? "disabled" : ""} aria-label="Send message">${streaming ? `<span class="spinner"></span>` : icon("send")}</button>
        </div>
        <div class="chat-foot">
          <span>Enter to send · Shift + Enter for a new line</span>
          <span>${pod ? `context: ${escapeHtml(pod.name)}` : "context: whole cluster"} · ${escapeHtml(provider?.label || "no provider")}</span>
        </div>
      </div>
    </section>
    ${aside(state)}
  </div>`;
}
