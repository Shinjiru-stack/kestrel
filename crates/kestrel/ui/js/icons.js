/* Icon helper backed by the inline SVG sprite in index.html. */

const ICONS = new Set([
  "logo", "grid", "cube", "server", "sparkles", "shield", "settings", "search",
  "command", "bell", "chevron-down", "chevron-right", "chevron-left",
  "arrow-up-right", "arrow-right", "plus", "refresh", "play", "pause", "restart",
  "trash", "terminal", "logs", "activity", "cpu", "memory", "network", "clock",
  "check", "alert", "x-circle", "info", "copy", "download", "filter", "sort",
  "more", "close", "minimize", "maximize", "restore", "moon", "sun", "user",
  "github", "key", "zap", "layers", "git-branch", "lock", "eye", "send", "stop",
  "wand", "external", "database", "bell-off", "circle", "half", "rotate", "bolt",
  "shield-check", "file", "pulse",
]);

export function icon(name, className = "") {
  const safe = ICONS.has(name) ? name : "circle";
  return `<svg class="icon${className ? ` ${className}` : ""}" aria-hidden="true" focusable="false"><use href="#i-${safe}"></use></svg>`;
}

export function hasIcon(name) {
  return ICONS.has(name);
}
