import http from "node:http";

const PORT = 18999;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIAGNOSIS = JSON.stringify({
  summary: "Mock diagnosis: the container is failing its health check.",
  severity: "critical",
  rootCause: "Mock root cause: the configured probe path does not exist.",
  confidence: 0.91,
  evidence: ["Mock evidence from the supplied pod context."],
  recommendations: [
    {
      title: "Fix the probe path",
      detail: "Point the probe at a handler that returns HTTP 200.",
      risk: "low",
      action: null,
    },
  ],
  commands: ["kubectl describe pod crashing-pod -n broken-apps"],
  prevention: ["Add a startup probe and test probe paths in CI."],
});

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sse(res, chunks, done = true) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  (async () => {
    for (const chunk of chunks) {
      res.write(chunk);
      await sleep(40);
    }
    if (done) res.end();
  })();
}

function openaiChunk(model, text, usage) {
  const payload = {
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta: text ? { content: text } : {}, finish_reason: text ? null : "stop" }],
  };
  if (usage) payload.usage = usage;
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const body = req.method === "POST" ? await readBody(req) : {};
  console.log(`${req.method} ${url.pathname}${url.search} stream=${body.stream ?? "n/a"} model=${body.model ?? "n/a"}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/openrouter/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "mock-openrouter" }, { id: "mock-openrouter-mini" }] }));
    return;
  }
  if (url.pathname === "/github/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "mock-copilot", model_picker_enabled: true }, { id: "mock-copilot-mini" }] }));
    return;
  }
  if (url.pathname === "/anthropic/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "mock-claude", display_name: "Mock Claude" }] }));
    return;
  }
  if (url.pathname === "/gemini/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        models: [
          { name: "models/mock-gemini", supportedGenerationMethods: ["generateContent"] },
          { name: "models/mock-gemini-pro", supportedGenerationMethods: ["generateContent"] },
        ],
      })
    );
    return;
  }

  if (url.pathname.endsWith("/chat/completions") && req.method === "POST") {
    const model = body.model || "mock";
    const text = url.pathname.startsWith("/github/") ? "GITHUB_COPILOT_OK" : "OPENROUTER_OK";
    if (!body.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model, choices: [{ message: { role: "assistant", content: DIAGNOSIS } }], usage: { prompt_tokens: 12, completion_tokens: 2 } }));
      return;
    }
    const half = Math.floor(text.length / 2);
    sse(res, [
      openaiChunk(model, text.slice(0, half)),
      openaiChunk(model, text.slice(half)),
      openaiChunk(model, "", { prompt_tokens: 12, completion_tokens: 2 }),
      "data: [DONE]\n\n",
    ]);
    return;
  }

  if (url.pathname === "/anthropic/messages" && req.method === "POST") {
    if (!body.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "msg_mock", model: body.model, content: [{ type: "text", text: DIAGNOSIS }], usage: { input_tokens: 12, output_tokens: 2 } }));
      return;
    }
    sse(res, [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_mock", model: body.model, usage: { input_tokens: 12, output_tokens: 1 } } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ANTHROPIC_" } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ]);
    return;
  }

  if (url.pathname.includes(":generateContent")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: DIAGNOSIS }] } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2 },
        modelVersion: "mock-gemini",
      })
    );
    return;
  }

  if (url.pathname.includes(":streamGenerateContent")) {
    sse(res, [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "GEMINI_" }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1 } })}\n\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2 } })}\n\n`,
    ]);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: `mock route not found: ${req.method} ${url.pathname}` } }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`provider mock listening on http://127.0.0.1:${PORT}`);
});
