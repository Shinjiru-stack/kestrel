(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  location.hash = "#/copilot";
  await sleep(900);
  const input = document.getElementById("chat-input");
  if (!input) return JSON.stringify({ ok: false, error: "no chat input" });
  input.value = "In one short sentence, which failing pod should I fix first, and why?";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(200);
  const send = document.querySelector('[data-action="chat-send"]');
  if (!send) return JSON.stringify({ ok: false, error: "no send button" });
  send.click();
  const started = Date.now();
  for (let i = 0; i < 240; i += 1) {
    await sleep(1000);
    const error = document.querySelector(".risk-banner[data-tone='danger']");
    const assistant = [...document.querySelectorAll(".chat-msg--assistant .chat-bubble")].pop();
    const streaming = Boolean(document.querySelector(".chat-send .spinner"));
    const text = (assistant?.innerText || "").trim();
    if (error && error.innerText.trim()) {
      return JSON.stringify({ ok: false, elapsed: Math.round((Date.now() - started) / 1000), error: error.innerText.trim().slice(0, 900) });
    }
    if (text && !streaming) {
      return JSON.stringify({
        ok: true,
        elapsed: Math.round((Date.now() - started) / 1000),
        text: text.slice(0, 1200),
        meta: assistant.closest(".chat-msg")?.querySelector(".chat-msg__meta")?.innerText || "",
        provider: document.querySelector(".chat-panel__provider")?.innerText || "",
      });
    }
  }
  return JSON.stringify({ ok: false, error: "ollama chat timeout after 240s" });
})()
