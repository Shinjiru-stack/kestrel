import { icon } from "../icons.js";
import { escapeHtml } from "../format.js";

export function renderToasts(state) {
  const host = document.getElementById("toasts");
  if (!host) return;
  host.innerHTML = state.toasts
    .map(
      (t) => `<div class="toast" data-tone="${escapeHtml(t.tone)}" role="status">
        <span class="toast__icon">${icon(
          t.tone === "success" ? "check" : t.tone === "error" ? "x-circle" : t.tone === "warning" ? "alert" : "info"
        )}</span>
        <div class="toast__body">
          <div class="toast__title">${escapeHtml(t.title)}</div>
          ${t.description ? `<div class="toast__desc">${escapeHtml(t.description)}</div>` : ""}
        </div>
        <button class="toast__close" data-action="toast-close" data-id="${escapeHtml(t.id)}" aria-label="Dismiss">${icon("close")}</button>
      </div>`
    )
    .join("");
}
