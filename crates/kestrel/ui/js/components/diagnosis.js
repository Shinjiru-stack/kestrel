import { icon } from "../icons.js";
import { escapeHtml, riskTone, severityTone, fmtNumber } from "../format.js";

export function renderDiagnosis(diagnosis, options = {}) {
  if (!diagnosis) return renderDiagnosisEmpty(options);
  const tone = severityTone(diagnosis.severity);
  const confidence = Math.round((Number(diagnosis.confidence) || 0) * 100);
  const recs = diagnosis.recommendations || [];
  return `<div class="diagnosis">
    <div class="diagnosis__head">
      <span class="badge badge--dot" data-tone="${tone}">${escapeHtml(diagnosis.severity || "info")}</span>
      <span class="diagnosis__confidence"><i style="width:${confidence}%"></i><span>${confidence}% confidence</span></span>
      <span class="diagnosis__model">${escapeHtml(diagnosis.provider || "AI")} · ${escapeHtml(diagnosis.model || "model")}</span>
    </div>
    <h3 class="diagnosis__summary">${escapeHtml(diagnosis.summary || "Analysis complete")}</h3>
    ${diagnosis.rootCause ? `<p class="diagnosis__root">${escapeHtml(diagnosis.rootCause)}</p>` : ""}
    ${
      diagnosis.evidence?.length
        ? `<div class="diagnosis__section">
            <div class="diagnosis__label">${icon("eye")} Evidence</div>
            <ul class="diagnosis__evidence">
              ${diagnosis.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}
            </ul>
          </div>`
        : ""
    }
    ${
      recs.length
        ? `<div class="diagnosis__section">
            <div class="diagnosis__label">${icon("wand")} Recommended actions</div>
            <div class="diagnosis__recs">
              ${recs
                .map(
                  (rec, i) => `<div class="diagnosis__rec" data-risk="${escapeHtml(rec.risk || "medium")}">
                    <div class="diagnosis__rec-head">
                      <span class="diagnosis__rec-index">${String(i + 1).padStart(2, "0")}</span>
                      <strong>${escapeHtml(rec.title)}</strong>
                      <span class="badge" data-tone="${riskTone(rec.risk)}">${escapeHtml(rec.risk || "medium")} risk</span>
                    </div>
                    <p>${escapeHtml(rec.detail || "")}</p>
                    ${
                      rec.action
                        ? `<div class="diagnosis__rec-foot">
                            <button class="btn btn--sm btn--subtle" data-action="diagnosis-apply" data-rec-index="${i}">${icon("play")} Prepare action</button>
                            <span class="mono faint">approval required</span>
                          </div>`
                        : `<div class="diagnosis__rec-foot"><span class="mono faint">manual action</span></div>`
                    }
                  </div>`
                )
                .join("")}
            </div>
          </div>`
        : ""
    }
    ${
      diagnosis.commands?.length
        ? `<div class="diagnosis__section">
            <div class="diagnosis__label">${icon("terminal")} Verify with</div>
            ${diagnosis.commands
              .map(
                (cmd) => `<div class="code-block"><button class="copy-btn code-block__copy" data-action="copy" data-copy="${escapeHtml(cmd)}" aria-label="Copy command">${icon("copy")}</button>${escapeHtml(cmd)}</div>`
              )
              .join("")}
          </div>`
        : ""
    }
    ${
      diagnosis.prevention?.length
        ? `<div class="diagnosis__section">
            <div class="diagnosis__label">${icon("shield-check")} Prevent recurrence</div>
            <ul class="diagnosis__evidence">
              ${diagnosis.prevention.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}
            </ul>
          </div>`
        : ""
    }
    <div class="diagnosis__foot">
      <span class="mono faint">${fmtNumber(diagnosis.usage?.inputTokens || 0)} in / ${fmtNumber(diagnosis.usage?.outputTokens || 0)} out tokens</span>
      ${diagnosis.raw ? `<button class="btn btn--sm btn--ghost" data-action="diagnosis-raw">${icon("file")} Raw output</button>` : ""}
    </div>
  </div>`;
}

export function renderDiagnosisEmpty(options = {}) {
  const title = options.title || "No diagnosis yet";
  const desc =
    options.desc ||
    "Ask the Copilot to correlate the pod status, warning events, and recent logs. It will return a root cause, evidence, and an approval-gated remediation.";
  return `<div class="empty diagnosis-empty">
    <div class="empty__icon">${icon("sparkles")}</div>
    <div class="empty__title">${escapeHtml(title)}</div>
    <div class="empty__desc">${escapeHtml(desc)}</div>
    ${
      options.action
        ? `<div class="empty__actions"><button class="btn btn--primary" data-action="${escapeHtml(options.action)}">${icon("wand")} ${escapeHtml(options.label || "Diagnose pod")}</button></div>`
        : ""
    }
  </div>`;
}

export function renderDiagnosisLoading(label = "Reasoning over pod state, events, and logs…") {
  return `<div class="diagnosis-loading">
    <div class="diagnosis-loading__orb">${icon("sparkles")}</div>
    <div>
      <strong>${escapeHtml(label)}</strong>
      <span class="mono faint">this usually takes 4–12 seconds</span>
    </div>
    <div class="spinner"></div>
  </div>`;
}
