import { icon } from "../icons.js";
import { escapeHtml, safeJson } from "../format.js";

let current = null;

export function openConfirm({
  title,
  sub = "",
  tone = "warning",
  iconName = "alert",
  body = "",
  action = null,
  target = "",
  confirmLabel = "Confirm",
  confirmTone = "primary",
  requireText = "",
  onConfirm,
}) {
  current = {
    title,
    sub,
    tone,
    iconName,
    body,
    action,
    target,
    confirmLabel,
    confirmTone,
    requireText,
    onConfirm,
  };
  renderModal();
  const modal = document.getElementById("modal");
  if (modal) modal.hidden = false;
  setTimeout(() => {
    const input = document.getElementById("modal-confirm-input");
    if (input) input.focus();
    else document.querySelector("[data-action='modal-confirm']")?.focus();
  }, 40);
}

export function openInfo({ title, sub = "", tone = "info", iconName = "info", body = "", target = "" }) {
  current = {
    title,
    sub,
    tone,
    iconName,
    body,
    target,
    confirmLabel: "Done",
    confirmTone: "primary",
    requireText: "",
    onConfirm: null,
  };
  renderModal();
  const modal = document.getElementById("modal");
  if (modal) modal.hidden = false;
}

export function closeModal() {
  current = null;
  const modal = document.getElementById("modal");
  if (modal) modal.hidden = true;
  const content = document.getElementById("modal-content");
  if (content) content.innerHTML = "";
}

export function getModal() {
  return current;
}

export async function confirmModal() {
  if (!current) return;
  if (current.requireText) {
    const input = document.getElementById("modal-confirm-input");
    if (!input || input.value.trim() !== current.requireText) {
      input?.focus();
      input?.classList.add("is-invalid");
      return;
    }
  }
  const fn = current.onConfirm;
  const payload = current;
  closeModal();
  if (fn) await fn(payload);
}

export function renderModal() {
  const host = document.getElementById("modal-content");
  if (!host) return;
  if (!current) {
    host.innerHTML = "";
    return;
  }
  const actionJson = current.action ? safeJson(current.action) : "";
  host.innerHTML = `
    <div class="modal__head">
      <span class="modal__icon" data-tone="${escapeHtml(current.tone)}">${icon(current.iconName)}</span>
      <div>
        <div class="modal__title">${escapeHtml(current.title)}</div>
        ${current.sub ? `<div class="modal__sub">${escapeHtml(current.sub)}</div>` : ""}
      </div>
    </div>
    <div class="modal__body">
      ${current.body || ""}
      ${
        current.target
          ? `<div class="confirm-target" style="margin-top:12px">${escapeHtml(current.target)}</div>`
          : ""
      }
      ${
        actionJson
          ? `<div class="risk-banner" data-tone="${current.tone === "danger" ? "danger" : "warning"}" style="margin-top:10px">
              ${icon("alert")}
              <div><strong>Exact mutation</strong><div class="mono" style="margin-top:3px;font-size:9.5px;white-space:pre-wrap">${escapeHtml(actionJson)}</div></div>
            </div>`
          : ""
      }
      ${
        current.requireText
          ? `<div class="field" style="margin-top:12px">
              <label class="label" for="modal-confirm-input">Type <span class="mono">${escapeHtml(current.requireText)}</span> to confirm</label>
              <input class="input" id="modal-confirm-input" autocomplete="off" spellcheck="false" />
            </div>`
          : ""
      }
    </div>
    <div class="modal__foot">
      <button class="btn btn--ghost" data-action="modal-close">Cancel</button>
      <button class="btn ${current.confirmTone === "danger" ? "btn--danger" : "btn--primary"}" data-action="modal-confirm">${escapeHtml(current.confirmLabel)}</button>
    </div>
  `;
}
