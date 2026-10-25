/* Formatting and DOM-safe string helpers. */

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function attr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

export function cls(...parts) {
  return parts.filter(Boolean).join(" ");
}

export function fmtAge(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 60) return `${s} sec`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr`;
  return `${Math.floor(s / 86400)} days`;
}

export function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function fmtTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(11, 19);
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

export function fmtClock(value = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function fmtNumber(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

export function fmtCompact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function fmtCpu(cores) {
  const n = Number(cores);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n < 0.01) return `${Math.round(n * 1000)}m`;
  if (n < 1) return `${Math.round(n * 1000)}m`;
  return `${n.toFixed(n < 10 ? 1 : 0)}`;
}

export function fmtBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function fmtMemory(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return fmtBytes(n);
}

export function pct(value, max = 100) {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) return 0;
  return Math.max(0, Math.min(100, (v / m) * 100));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function healthTone(health) {
  return (
    {
      healthy: "success",
      warning: "warning",
      failed: "critical",
      pending: "info",
      unknown: "neutral",
    }[health] || "neutral"
  );
}

export function severityTone(severity) {
  return (
    {
      critical: "critical",
      high: "critical",
      warning: "warning",
      medium: "warning",
      info: "info",
      low: "info",
      success: "success",
    }[String(severity || "").toLowerCase()] || "neutral"
  );
}

export function riskTone(risk) {
  return (
    {
      high: "critical",
      medium: "warning",
      low: "success",
      none: "neutral",
    }[String(risk || "").toLowerCase()] || "neutral"
  );
}

export function statusTone(status) {
  const s = String(status || "").toLowerCase();
  if (["running", "ready", "healthy", "succeeded", "active", "connected"].includes(s)) return "success";
  if (["pending", "progressing", "terminating", "scaled to zero", "connecting"].includes(s)) return "info";
  if (["failed", "crashloopbackoff", "oomkilled", "evicted", "error", "notready"].includes(s)) return "critical";
  if (s) return "warning";
  return "neutral";
}

export function plural(n, singular, pluralForm = `${singular}s`) {
  return `${fmtNumber(n)} ${Number(n) === 1 ? singular : pluralForm}`;
}

export function truncate(value, max = 80) {
  const s = String(value ?? "");
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function initials(value) {
  return String(value || "?")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function humanize(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shortenImage(image) {
  const s = String(image || "");
  const parts = s.split("/");
  const last = parts.pop() || s;
  const [name, tag] = last.split(":");
  return `${name}${tag ? `:${tag}` : ""}`;
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlight(value, query) {
  const text = escapeHtml(value);
  const q = String(query || "").trim();
  if (!q) return text;
  try {
    return text.replace(new RegExp(`(${escapeRegExp(escapeHtml(q))})`, "ig"), "<mark>$1</mark>");
  } catch {
    return text;
  }
}

export function debounce(fn, wait = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function deepClone(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function parseMemoryToBytes(value) {
  const s = String(value || "").trim();
  const match = s.match(/^([0-9.]+)\s*(Ki|Mi|Gi|Ti|K|M|G|T|k)?$/);
  if (!match) return 0;
  const n = Number(match[1]);
  const unit = match[2] || "";
  const mult = {
    "": 1,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    k: 1000,
  }[unit] || 1;
  return n * mult;
}

/* Minimal, safe markdown rendering for assistant messages. */
export function markdownToHtml(markdown) {
  let text = String(markdown ?? "");
  const blocks = [];
  text = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = blocks.length;
    blocks.push(`<pre><code data-lang="${escapeHtml(lang)}">${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000BLOCK${idx}\u0000`;
  });
  text = escapeHtml(text);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  text = text.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  text = text.replace(/^# (.+)$/gm, "<h3>$1</h3>");

  const lines = text.split("\n");
  const out = [];
  let list = null;
  for (const line of lines) {
    const ul = line.match(/^\s*[-*+] (.+)$/);
    const ol = line.match(/^\s*\d+\. (.+)$/);
    if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      if (list !== tag) {
        if (list) out.push(`</${list}>`);
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li>${(ul || ol)[1]}</li>`);
      continue;
    }
    if (line.trim() === "") {
      if (!list) out.push("");
      continue;
    }
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
    out.push(`<p>${line}</p>`);
  }
  if (list) out.push(`</${list}>`);
  let html = out.join("\n");
  html = html.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[Number(i)] || "");
  return html;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}
