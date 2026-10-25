import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const port = Number(process.argv[2] || 9222);
const out = process.argv[3] || join(tmpdir(), "kh-tauri.png");
const rawScript = process.argv[4] || "";
const script = rawScript.startsWith("@") ? await readFile(rawScript.slice(1), "utf8") : rawScript;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
const page = targets.find((t) => t.type === "page" && t.url.includes("tauri.localhost")) || targets.find((t) => t.type === "page" && !t.url.startsWith("about:")) || targets.find((t) => t.type === "page");
if (!page) throw new Error("no page target");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 1;
const pending = new Map();
const errors = [];
const logs = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id) {
    const entry = pending.get(msg.id);
    if (entry) {
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
    }
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    errors.push(msg.params.args.map((a) => a.value || a.description || "").join(" "));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || "exception");
  }
  if (msg.method === "Log.entryAdded" && ["error", "warning"].includes(msg.params.entry.level)) {
    logs.push(`${msg.params.entry.level}: ${msg.params.entry.text}`);
  }
};

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Runtime.enable");
await send("Log.enable");
await sleep(500);

let scriptResult = null;
if (script) {
  const res = await send("Runtime.evaluate", {
    expression: script,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  scriptResult = res.result?.value ?? res.result?.description ?? null;
  if (res.exceptionDetails) {
    errors.push(res.exceptionDetails.exception?.description || res.exceptionDetails.text || "eval failed");
  }
  await sleep(1200);
}

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(out, Buffer.from(shot.data, "base64"));

const metrics = await send("Runtime.evaluate", {
  expression: `(() => {
    const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; };
    return JSON.stringify({
      title: document.title,
      route: location.hash,
      booted: !document.getElementById('shell')?.hidden,
      viewChildren: document.getElementById('view')?.children.length,
      viewText: (document.getElementById('view')?.innerText || '').slice(0, 160),
      inner: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      main: rect('.main'),
      drawer: rect('#drawer'),
      palette: rect('#palette'),
      modal: rect('#modal'),
      toasts: [...document.querySelectorAll('.toast')].map(t => t.innerText.slice(0, 80)),
      bodyClass: document.body.className,
      htmlTheme: document.documentElement.dataset.theme,
      tauri: Boolean(window.__TAURI__),
    });
  })()`,
  returnByValue: true,
});

console.log(JSON.stringify({ out, scriptResult, metrics: JSON.parse(metrics.result.value), errors, logs }, null, 2));
ws.close();
