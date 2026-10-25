use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedSender;

use crate::models::{
    ActionSpec, ClusterSnapshot, Diagnosis, LogResponse, PodDetail, Recommendation, Usage, now_iso,
};
use crate::settings::{ProviderKind, ProviderSettings, Settings};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

impl AiMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChatRequest {
    pub system: String,
    pub messages: Vec<AiMessage>,
    pub temperature: f32,
    pub max_tokens: u32,
    pub json: bool,
}

impl ChatRequest {
    pub fn new(system: impl Into<String>, messages: Vec<AiMessage>) -> Self {
        Self {
            system: system.into(),
            messages,
            temperature: 0.2,
            max_tokens: 4096,
            json: false,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResponse {
    pub content: String,
    pub usage: Usage,
    pub model: String,
}

pub type StreamTx = UnboundedSender<String>;

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Kestrel/0.1 (desktop; +https://github.com/Shinjiru-stack/kestrel)")
            .timeout(Duration::from_secs(240))
            .connect_timeout(Duration::from_secs(20))
            .build()
            .expect("failed to build HTTP client")
    })
}

fn kind_of(provider: &ProviderSettings) -> Result<ProviderKind> {
    ProviderKind::parse(&provider.kind)
        .ok_or_else(|| anyhow!("unknown AI provider: {}", provider.kind))
}

fn require_key(provider: &ProviderSettings) -> Result<&str> {
    let key = provider.api_key.trim();
    if key.is_empty() {
        return Err(anyhow!(
            "{} is not configured. Add an API key in Settings.",
            provider.label
        ));
    }
    Ok(key)
}

fn base(provider: &ProviderSettings) -> String {
    provider.base_url.trim().trim_end_matches('/').to_string()
}

fn status_error(status: reqwest::StatusCode, body: &str) -> anyhow::Error {
    let clean = body.trim();
    let clean: String = if clean.chars().count() > 1200 {
        format!("{}…", clean.chars().take(1200).collect::<String>())
    } else {
        clean.to_string()
    };
    anyhow!("provider returned HTTP {status}: {clean}")
}

async fn ensure_ok(resp: reqwest::Response) -> Result<reqwest::Response> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    Err(status_error(status, &body))
}

fn estimate_usage(req: &ChatRequest, output: &str) -> Usage {
    let input_chars = req.system.chars().count()
        + req
            .messages
            .iter()
            .map(|m| m.content.chars().count())
            .sum::<usize>();
    Usage {
        input_tokens: (input_chars / 4).max(1) as u64,
        output_tokens: (output.chars().count() / 4).max(1) as u64,
    }
}

fn usage_from_openai(v: &Value) -> Usage {
    Usage {
        input_tokens: v.get("prompt_tokens").and_then(Value::as_u64).unwrap_or(0),
        output_tokens: v
            .get("completion_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

pub async fn complete(provider: &ProviderSettings, req: &ChatRequest) -> Result<AiResponse> {
    run_chat(provider, req, None).await
}

pub async fn stream(
    provider: &ProviderSettings,
    req: &ChatRequest,
    tx: StreamTx,
) -> Result<AiResponse> {
    run_chat(provider, req, Some(tx)).await
}

async fn run_chat(
    provider: &ProviderSettings,
    req: &ChatRequest,
    tx: Option<StreamTx>,
) -> Result<AiResponse> {
    if !provider.enabled {
        return Err(anyhow!(
            "{} is disabled. Enable it in Settings.",
            provider.label
        ));
    }
    match kind_of(provider)? {
        ProviderKind::Ollama => ollama_chat(provider, req, tx).await,
        ProviderKind::Gemini => gemini_chat(provider, req, tx).await,
        ProviderKind::OpenRouter => {
            let key = require_key(provider)?;
            let mut headers = HeaderMap::new();
            headers.insert(
                "HTTP-Referer",
                HeaderValue::from_static("https://github.com/Shinjiru-stack/kestrel"),
            );
            headers.insert("X-Title", HeaderValue::from_static("Kestrel"));
            openai_chat_at(&base(provider), key, &provider.model, headers, req, tx).await
        }
        ProviderKind::Anthropic => anthropic_chat(provider, req, tx).await,
        ProviderKind::GithubCopilot => copilot_chat(provider, req, tx).await,
    }
}

pub async fn list_models(provider: &ProviderSettings) -> Result<Vec<String>> {
    match kind_of(provider)? {
        ProviderKind::Ollama => ollama_models(provider).await,
        ProviderKind::Gemini => gemini_models(provider).await,
        ProviderKind::OpenRouter => {
            let key = require_key(provider)?;
            let resp = http()
                .get(format!("{}/models", base(provider)))
                .bearer_auth(key)
                .send()
                .await?;
            let resp = ensure_ok(resp).await?;
            let body: Value = resp.json().await?;
            let mut models = body
                .get("data")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            models.sort();
            Ok(models)
        }
        ProviderKind::Anthropic => anthropic_models(provider).await,
        ProviderKind::GithubCopilot => copilot_models(provider).await,
    }
}

pub async fn test_provider(provider: &ProviderSettings) -> Result<(Vec<String>, u64)> {
    let start = Instant::now();
    let models = list_models(provider).await?;
    Ok((models, start.elapsed().as_millis() as u64))
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

fn ollama_root(provider: &ProviderSettings) -> String {
    let b = base(provider);
    b.strip_suffix("/v1")
        .unwrap_or(&b)
        .trim_end_matches('/')
        .to_string()
}

async fn ollama_models(provider: &ProviderSettings) -> Result<Vec<String>> {
    let resp = http()
        .get(format!("{}/api/tags", ollama_root(provider)))
        .send()
        .await?;
    let resp = ensure_ok(resp).await?;
    let body: Value = resp.json().await?;
    let mut models = body
        .get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|m| m.get("name").and_then(Value::as_str).map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    models.sort();
    Ok(models)
}

async fn ollama_chat(
    provider: &ProviderSettings,
    req: &ChatRequest,
    tx: Option<StreamTx>,
) -> Result<AiResponse> {
    let mut messages = Vec::new();
    if !req.system.trim().is_empty() {
        messages.push(json!({"role":"system","content":req.system}));
    }
    for m in &req.messages {
        messages.push(json!({"role":m.role,"content":m.content}));
    }
    let streaming = tx.is_some();
    let mut body = json!({
        "model": provider.model,
        "messages": messages,
        "stream": streaming,
        "options": {
            "temperature": req.temperature,
            "num_predict": req.max_tokens
        }
    });
    if req.json {
        body["format"] = Value::String("json".into());
    }
    let resp = http()
        .post(format!("{}/api/chat", ollama_root(provider)))
        .json(&body)
        .send()
        .await?;
    let resp = ensure_ok(resp).await?;

    if !streaming {
        let v: Value = resp.json().await?;
        let content = v
            .pointer("/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let usage = Usage {
            input_tokens: v
                .get("prompt_eval_count")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            output_tokens: v.get("eval_count").and_then(Value::as_u64).unwrap_or(0),
        };
        return Ok(AiResponse {
            content,
            usage: if usage.input_tokens == 0 && usage.output_tokens == 0 {
                estimate_usage(req, "")
            } else {
                usage
            },
            model: v
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or(&provider.model)
                .to_string(),
        });
    }

    let tx = tx.unwrap();
    let mut content = String::new();
    let mut usage = Usage::default();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if let Some(err) = v.get("error").and_then(Value::as_str) {
                return Err(anyhow!("Ollama: {err}"));
            }
            if let Some(text) = v.pointer("/message/content").and_then(Value::as_str)
                && !text.is_empty()
            {
                content.push_str(text);
                let _ = tx.send(text.to_string());
            }
            usage.input_tokens = v
                .get("prompt_eval_count")
                .and_then(Value::as_u64)
                .unwrap_or(usage.input_tokens);
            usage.output_tokens = v
                .get("eval_count")
                .and_then(Value::as_u64)
                .unwrap_or(usage.output_tokens);
            if v.get("done").and_then(Value::as_bool) == Some(true) {
                break;
            }
        }
    }
    if usage.input_tokens == 0 && usage.output_tokens == 0 {
        usage = estimate_usage(req, &content);
    }
    Ok(AiResponse {
        content,
        usage,
        model: provider.model.clone(),
    })
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (OpenRouter, Copilot, GitHub Models)
// ---------------------------------------------------------------------------

async fn openai_chat_at(
    base_url: &str,
    key: &str,
    model: &str,
    extra_headers: HeaderMap,
    req: &ChatRequest,
    tx: Option<StreamTx>,
) -> Result<AiResponse> {
    let mut messages = Vec::new();
    if !req.system.trim().is_empty() {
        messages.push(json!({"role":"system","content":req.system}));
    }
    for m in &req.messages {
        messages.push(json!({"role":m.role,"content":m.content}));
    }
    let streaming = tx.is_some();
    let mut body = json!({
        "model": model,
        "messages": messages,
        "temperature": req.temperature,
        "max_tokens": req.max_tokens,
        "stream": streaming
    });
    if streaming {
        body["stream_options"] = json!({"include_usage": true});
    }
    if req.json {
        body["response_format"] = json!({"type":"json_object"});
    }

    let mut builder = http()
        .post(format!(
            "{}/chat/completions",
            base_url.trim_end_matches('/')
        ))
        .bearer_auth(key)
        .json(&body);
    for (k, v) in extra_headers.iter() {
        builder = builder.header(k, v);
    }
    let resp = builder.send().await?;
    let resp = ensure_ok(resp).await?;

    if !streaming {
        let v: Value = resp.json().await?;
        let content = v
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let usage = v
            .get("usage")
            .map(usage_from_openai)
            .filter(|u| u.input_tokens > 0 || u.output_tokens > 0)
            .unwrap_or_else(|| estimate_usage(req, &content));
        return Ok(AiResponse {
            content,
            usage,
            model: v
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        });
    }

    let tx = tx.unwrap();
    let mut content = String::new();
    let mut usage = Usage::default();
    let mut model = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                break;
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(err) = v.get("error") {
                let msg = err
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("provider error");
                return Err(anyhow!("provider: {msg}"));
            }
            if let Some(m) = v.get("model").and_then(Value::as_str) {
                model = m.to_string();
            }
            if let Some(text) = v
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
                && !text.is_empty()
            {
                content.push_str(text);
                let _ = tx.send(text.to_string());
            }
            if let Some(u) = v.get("usage") {
                let parsed = usage_from_openai(u);
                if parsed.input_tokens > 0 || parsed.output_tokens > 0 {
                    usage = parsed;
                }
            }
        }
    }
    if usage.input_tokens == 0 && usage.output_tokens == 0 {
        usage = estimate_usage(req, &content);
    }
    Ok(AiResponse {
        content,
        usage,
        model,
    })
}

fn openai_headers_with_model(_model: &str) -> HeaderMap {
    HeaderMap::new()
}
// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

fn gemini_endpoint(provider: &ProviderSettings, model: &str, stream: bool) -> String {
    let b = base(provider);
    if stream {
        format!(
            "{b}/models/{model}:streamGenerateContent?alt=sse&key={}",
            provider.api_key.trim()
        )
    } else {
        format!(
            "{b}/models/{model}:generateContent?key={}",
            provider.api_key.trim()
        )
    }
}

async fn gemini_models(provider: &ProviderSettings) -> Result<Vec<String>> {
    let key = require_key(provider)?;
    let resp = http()
        .get(format!("{}/models?key={key}", base(provider)))
        .send()
        .await?;
    let resp = ensure_ok(resp).await?;
    let body: Value = resp.json().await?;
    let mut models = body
        .get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|m| {
                    m.get("supportedGenerationMethods")
                        .and_then(Value::as_array)
                        .map(|methods| {
                            methods
                                .iter()
                                .any(|v| v.as_str() == Some("generateContent"))
                        })
                        .unwrap_or(true)
                })
                .filter_map(|m| m.get("name").and_then(Value::as_str))
                .map(|name| name.strip_prefix("models/").unwrap_or(name).to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    models.sort();
    Ok(models)
}

fn gemini_body(req: &ChatRequest) -> Value {
    let contents = req
        .messages
        .iter()
        .map(|m| {
            let role = if m.role == "assistant" {
                "model"
            } else {
                "user"
            };
            json!({"role": role, "parts": [{"text": m.content}]})
        })
        .collect::<Vec<_>>();
    let mut generation = json!({
        "temperature": req.temperature,
        "maxOutputTokens": req.max_tokens
    });
    if req.json {
        generation["responseMimeType"] = Value::String("application/json".into());
    }
    let mut body = json!({
        "contents": contents,
        "generationConfig": generation
    });
    if !req.system.trim().is_empty() {
        body["systemInstruction"] = json!({"parts":[{"text": req.system}]});
    }
    body
}

fn gemini_text(v: &Value) -> String {
    v.pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect::<String>()
        })
        .unwrap_or_default()
}

fn gemini_usage(v: &Value) -> Usage {
    let meta = v.get("usageMetadata");
    Usage {
        input_tokens: meta
            .and_then(|m| m.get("promptTokenCount"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        output_tokens: meta
            .and_then(|m| m.get("candidatesTokenCount"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
    }
}

async fn gemini_chat(
    provider: &ProviderSettings,
    req: &ChatRequest,
    tx: Option<StreamTx>,
) -> Result<AiResponse> {
    require_key(provider)?;
    let streaming = tx.is_some();
    let resp = http()
        .post(gemini_endpoint(provider, &provider.model, streaming))
        .json(&gemini_body(req))
        .send()
        .await?;
    let resp = ensure_ok(resp).await?;

    if !streaming {
        let v: Value = resp.json().await?;
        if let Some(err) = v.get("error") {
            return Err(anyhow!(
                "Gemini: {}",
                err.get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("request failed")
            ));
        }
        let content = gemini_text(&v);
        let usage = gemini_usage(&v);
        return Ok(AiResponse {
            content: content.clone(),
            usage: if usage.input_tokens == 0 && usage.output_tokens == 0 {
                estimate_usage(req, &content)
            } else {
                usage
            },
            model: provider.model.clone(),
        });
    }

    let tx = tx.unwrap();
    let mut content = String::new();
    let mut usage = Usage::default();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(err) = v.get("error") {
                return Err(anyhow!(
                    "Gemini: {}",
                    err.get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("request failed")
                ));
            }
            let text = gemini_text(&v);
            if !text.is_empty() {
                content.push_str(&text);
                let _ = tx.send(text);
            }
            let u = gemini_usage(&v);
            if u.input_tokens > 0 || u.output_tokens > 0 {
                usage = u;
            }
        }
    }
    if usage.input_tokens == 0 && usage.output_tokens == 0 {
        usage = estimate_usage(req, &content);
    }
    Ok(AiResponse {
        content,
        usage,
        model: provider.model.clone(),
    })
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

fn anthropic_proxy(provider: &ProviderSettings) -> bool {
    !base(provider).contains("api.anthropic.com")
}

async fn anthropic_models(provider: &ProviderSettings) -> Result<Vec<String>> {
    let key = require_key(provider)?;
    let mut request = http()
        .get(format!("{}/models?limit=100", base(provider)))
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01");
    if anthropic_proxy(provider) {
        request = request.header("Authorization", format!("Bearer {key}"));
    }
    let resp = request.send().await?;
    let resp = ensure_ok(resp).await?;
    let body: Value = resp.json().await?;
    let mut models = body
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    models.sort();
    Ok(models)
}

async fn anthropic_chat(
    provider: &ProviderSettings,
    req: &ChatRequest,
    tx: Option<StreamTx>,
) -> Result<AiResponse> {
    let key = require_key(provider)?;
    let streaming = tx.is_some();
    let messages = req
        .messages
        .iter()
        .map(|m| {
            let role = if m.role == "assistant" {
                "assistant"
            } else {
                "user"
            };
            json!({"role": role, "content": m.content})
        })
        .collect::<Vec<_>>();
    let mut body = json!({
        "model": provider.model,
        "max_tokens": req.max_tokens,
        "temperature": req.temperature,
        "messages": messages,
        "stream": streaming
    });
    if !req.system.trim().is_empty() {
        body["system"] = Value::String(req.system.clone());
    }
    let mut request = http()
        .post(format!("{}/messages", base(provider)))
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&body);
    if anthropic_proxy(provider) {
        request = request.header("Authorization", format!("Bearer {key}"));
    }
    let resp = request.send().await?;
    let resp = ensure_ok(resp).await?;

    if !streaming {
        let v: Value = resp.json().await?;
        if let Some(err) = v.get("error") {
            return Err(anyhow!(
                "Anthropic: {}",
                err.get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("request failed")
            ));
        }
        let content = v
            .get("content")
            .and_then(Value::as_array)
            .map(|parts| {
                parts
                    .iter()
                    .filter_map(|p| p.get("text").and_then(Value::as_str))
                    .collect::<String>()
            })
            .unwrap_or_default();
        let usage = v
            .get("usage")
            .map(|u| Usage {
                input_tokens: u.get("input_tokens").and_then(Value::as_u64).unwrap_or(0),
                output_tokens: u.get("output_tokens").and_then(Value::as_u64).unwrap_or(0),
            })
            .unwrap_or_default();
        return Ok(AiResponse {
            content: content.clone(),
            usage: if usage.input_tokens == 0 && usage.output_tokens == 0 {
                estimate_usage(req, &content)
            } else {
                usage
            },
            model: provider.model.clone(),
        });
    }

    let tx = tx.unwrap();
    let mut content = String::new();
    let mut usage = Usage::default();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            let event_type = v.get("type").and_then(Value::as_str).unwrap_or_default();
            match event_type {
                "content_block_delta" => {
                    if let Some(text) = v.pointer("/delta/text").and_then(Value::as_str)
                        && !text.is_empty()
                    {
                        content.push_str(text);
                        let _ = tx.send(text.to_string());
                    }
                }
                "message_start" => {
                    if let Some(u) = v.pointer("/message/usage") {
                        usage.input_tokens =
                            u.get("input_tokens").and_then(Value::as_u64).unwrap_or(0);
                    }
                }
                "message_delta" => {
                    if let Some(u) = v.get("usage") {
                        usage.output_tokens =
                            u.get("output_tokens").and_then(Value::as_u64).unwrap_or(0);
                    }
                }
                "error" => {
                    return Err(anyhow!(
                        "Anthropic: {}",
                        v.pointer("/error/message")
                            .and_then(Value::as_str)
                            .unwrap_or("stream failed")
                    ));
                }
                _ => {}
            }
        }
    }
    if usage.input_tokens == 0 && usage.output_tokens == 0 {
        usage = estimate_usage(req, &content);
    }
    Ok(AiResponse {
        content,
        usage,
        model: provider.model.clone(),
    })
}

// ---------------------------------------------------------------------------
// GitHub Copilot / GitHub Models
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct CopilotToken {
    token: String,
    expires_at: i64,
    base_url: String,
}

fn copilot_cache() -> &'static Mutex<HashMap<String, CopilotToken>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CopilotToken>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn copilot_models_base(provider: &ProviderSettings) -> String {
    let configured = base(provider);
    // Older settings stored the Copilot API root here. In Models-only mode
    // that endpoint cannot serve chat completions, so normalize it.
    if configured.is_empty() || configured.contains("api.githubcopilot.com") {
        "https://models.github.ai/inference".into()
    } else {
        configured
    }
}

async fn copilot_token(provider: &ProviderSettings) -> Result<CopilotToken> {
    let pat = require_key(provider)?;
    let cache_key = format!("{}|{}|{}", provider.base_url, provider.mode, pat);
    if let Ok(cache) = copilot_cache().lock()
        && let Some(t) = cache.get(&cache_key)
        && t.expires_at > chrono::Utc::now().timestamp() + 60
    {
        return Ok(t.clone());
    }

    let preferred = provider.mode.as_str();
    if preferred == "models" || preferred == "github-models" {
        let token = CopilotToken {
            token: pat.to_string(),
            expires_at: chrono::Utc::now().timestamp() + 3600,
            base_url: copilot_models_base(provider),
        };
        if let Ok(mut cache) = copilot_cache().lock() {
            cache.insert(cache_key.clone(), token.clone());
        }
        return Ok(token);
    }

    let resp = http()
        .post("https://api.github.com/copilot_internal/v2/token")
        .header("Authorization", format!("token {pat}"))
        .header("Accept", "application/json")
        .header("Editor-Version", "vscode/1.95.0")
        .header("Editor-Plugin-Version", "copilot/1.200.0")
        .send()
        .await;

    if let Ok(resp) = resp
        && resp.status().is_success()
    {
        let body: Value = resp.json().await.unwrap_or_default();
        if let Some(token) = body.get("token").and_then(Value::as_str) {
            let expires_at = body
                .get("expires_at")
                .and_then(Value::as_i64)
                .unwrap_or_else(|| chrono::Utc::now().timestamp() + 1500);
            let api = body
                .pointer("/endpoints/api")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| "https://api.githubcopilot.com".into());
            let out = CopilotToken {
                token: token.to_string(),
                expires_at,
                base_url: api,
            };
            if let Ok(mut cache) = copilot_cache().lock() {
                cache.insert(cache_key.clone(), out.clone());
            }
            return Ok(out);
        }
    }

    // Fallback to GitHub Models with the same PAT. This is a useful path for
    // users whose account has Models access but not an active Copilot seat.
    let out = CopilotToken {
        token: pat.to_string(),
        expires_at: chrono::Utc::now().timestamp() + 3600,
        base_url: copilot_models_base(provider),
    };
    if let Ok(mut cache) = copilot_cache().lock() {
        cache.insert(cache_key, out.clone());
    }
    Ok(out)
}

fn copilot_model_ids(body: &Value) -> Vec<String> {
    let items = body
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| body.as_array());
    let mut models = items
        .map(|items| {
            items
                .iter()
                .filter(|m| {
                    m.get("model_picker_enabled")
                        .and_then(Value::as_bool)
                        .unwrap_or(true)
                })
                .filter_map(|m| {
                    m.get("id")
                        .or_else(|| m.get("name"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    models.sort();
    models
}

async fn copilot_models(provider: &ProviderSettings) -> Result<Vec<String>> {
    let t = copilot_token(provider).await?;
    let root = t.base_url.trim_end_matches('/');
    let resp = http()
        .get(format!("{root}/models"))
        .bearer_auth(&t.token)
        .header("Copilot-Integration-Id", "vscode-chat")
        .header("Editor-Version", "vscode/1.95.0")
        .header("Editor-Plugin-Version", "copilot/1.200.0")
        .send()
        .await;
    if let Ok(resp) = resp
        && resp.status().is_success()
    {
        let body: Value = resp.json().await.unwrap_or_default();
        let models = copilot_model_ids(&body);
        if !models.is_empty() {
            return Ok(models);
        }
    }

    // GitHub Models exposes a catalog outside the inference root. Keep this
    // as a fallback for endpoints that do not implement /models.
    let catalog = if root.contains("models.github.ai") {
        "https://models.github.ai/catalog/models".to_string()
    } else {
        format!("{root}/catalog/models")
    };
    let resp = http().get(catalog).bearer_auth(&t.token).send().await;
    if let Ok(resp) = resp
        && resp.status().is_success()
    {
        let body: Value = resp.json().await.unwrap_or_default();
        let models = copilot_model_ids(&body);
        if !models.is_empty() {
            return Ok(models);
        }
    }
    Ok(vec![
        "gpt-4o".into(),
        "gpt-4.1".into(),
        "claude-sonnet-4".into(),
        "o4-mini".into(),
    ])
}

async fn copilot_chat(
    provider: &ProviderSettings,
    req: &ChatRequest,
    tx: Option<StreamTx>,
) -> Result<AiResponse> {
    let t = copilot_token(provider).await?;
    let mut headers = openai_headers_with_model(&provider.model);
    headers.insert(
        "Copilot-Integration-Id",
        HeaderValue::from_static("vscode-chat"),
    );
    headers.insert("Editor-Version", HeaderValue::from_static("vscode/1.95.0"));
    headers.insert(
        "Editor-Plugin-Version",
        HeaderValue::from_static("copilot/1.200.0"),
    );
    headers.insert(
        "Openai-Intent",
        HeaderValue::from_static("conversation-panel"),
    );
    let mut response =
        openai_chat_at(&t.base_url, &t.token, &provider.model, headers, req, tx).await?;
    if response.model.is_empty() {
        response.model = provider.model.clone();
    }
    Ok(response)
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

pub async fn diagnose(
    settings: &Settings,
    pod: &PodDetail,
    logs: Option<&LogResponse>,
    snapshot: Option<&ClusterSnapshot>,
) -> Result<Diagnosis> {
    let provider = settings
        .active()
        .ok_or_else(|| anyhow!("no active AI provider is configured"))?;
    let req = ChatRequest {
        system: diagnosis_system_prompt(),
        messages: vec![AiMessage::user(build_diagnosis_context(
            pod, logs, snapshot,
        ))],
        temperature: 0.1,
        max_tokens: 4096,
        json: true,
    };
    let response = complete(provider, &req).await?;
    let mut diagnosis = parse_diagnosis(settings, pod, &response)?;
    diagnosis.provider = provider.kind.clone();
    diagnosis.model = if response.model.is_empty() {
        provider.model.clone()
    } else {
        response.model.clone()
    };
    Ok(diagnosis)
}

fn diagnosis_system_prompt() -> String {
    r#"You are Kestrel, a principal Kubernetes site-reliability engineer. You diagnose live cluster incidents from pod status, events, and logs. Be precise, evidence-driven, and concise. Never invent log lines or events.

Return ONLY one JSON object. No markdown fences, no preamble, no trailing prose. The schema is:

{
  "summary": "one sentence describing the failure",
  "severity": "critical" | "warning" | "info",
  "rootCause": "the most likely root cause, with the causal chain",
  "confidence": 0.0,
  "evidence": ["specific fact from the supplied context"],
  "recommendations": [
    {
      "title": "short imperative title",
      "detail": "why this fixes it and what to watch",
      "risk": "low" | "medium" | "high",
      "action": null
    }
  ],
  "commands": ["safe kubectl or shell command for a human to run"],
  "prevention": ["one durable prevention step"]
}

Action objects are optional and MUST use one of these exact shapes:
{"type":"restartWorkload","kind":"Deployment|StatefulSet|DaemonSet","namespace":"...","name":"..."}
{"type":"deletePod","namespace":"...","name":"..."}
{"type":"patchImage","kind":"Deployment|StatefulSet|DaemonSet","namespace":"...","name":"...","container":"...","image":"..."}
{"type":"patchResources","kind":"Deployment|StatefulSet|DaemonSet","namespace":"...","name":"...","container":"...","resources":{"limits":{"memory":"512Mi"},"requests":{"memory":"256Mi"}}}
{"type":"scaleWorkload","kind":"Deployment|StatefulSet","namespace":"...","name":"...","replicas":1}

Rules:
- Prefer null actions. Only propose an action when the supplied evidence supports it.
- Never propose actions in kube-system, kube-public, or kube-node-lease.
- Never propose a memory limit above 1024Mi.
- Do not propose deleting a standalone pod unless it is Evicted or Failed.
- Confidence must be a number between 0 and 1, not a string.
- Keep the total response under 1200 words."#
        .to_string()
}

fn build_diagnosis_context(
    pod: &PodDetail,
    logs: Option<&LogResponse>,
    snapshot: Option<&ClusterSnapshot>,
) -> String {
    let mut out = String::new();
    out.push_str("TARGET\n");
    out.push_str(&format!(
        "kind=Pod namespace={} name={} phase={} status={} ready={} restarts={} node={}\n",
        pod.pod.namespace,
        pod.pod.name,
        pod.pod.phase,
        pod.pod.status,
        pod.pod.ready,
        pod.pod.restarts,
        pod.node_name
    ));
    out.push_str(&format!(
        "owner={}/{} standalone={} protected={}\n",
        pod.owner.kind, pod.owner.name, pod.owner.standalone, pod.owner.protected
    ));
    out.push_str(&format!(
        "images={:?}\nlabels={:?}\n",
        pod.pod.images, pod.pod.labels
    ));
    if let Some(cluster) = snapshot {
        out.push_str(&format!(
            "\nCLUSTER\nname={} version={} provider={} nodes={} pods={} metrics={}\n",
            cluster.cluster.name,
            cluster.cluster.version,
            cluster.cluster.provider,
            cluster.nodes.len(),
            cluster.pods.len(),
            cluster.metrics_available
        ));
    }
    out.push_str("\nCONDITIONS\n");
    for c in &pod.conditions {
        out.push_str(&format!(
            "- {}={} reason={} message={}\n",
            c.r#type, c.status, c.reason, c.message
        ));
    }
    out.push_str("\nCONTAINERS\n");
    for c in &pod.containers {
        out.push_str(&format!(
            "- {} image={} ready={} restarts={} state={} reason={} last={} exit={:?}\n",
            c.name, c.image, c.ready, c.restarts, c.state, c.reason, c.last_reason, c.exit_code
        ));
        out.push_str(&format!("  resources={}\n", c.resources));
        if !c.command.is_empty() {
            out.push_str(&format!("  command={:?}\n", c.command));
        }
        if !c.args.is_empty() {
            out.push_str(&format!("  args={:?}\n", c.args));
        }
    }
    out.push_str("\nDETERMINISTIC SUGGESTIONS\n");
    for s in &pod.suggestions {
        out.push_str(&format!(
            "- [{}] {}: {} (risk={})\n",
            s.severity, s.title, s.description, s.risk
        ));
        for e in &s.evidence {
            out.push_str(&format!("  evidence: {}\n", truncate(e, 300)));
        }
    }
    out.push_str("\nRECENT EVENTS\n");
    for e in pod.events.iter().take(35) {
        out.push_str(&format!(
            "- {} {} {}: {}\n",
            e.r#type,
            e.reason,
            e.involved_name,
            truncate(&e.message, 500)
        ));
    }
    if let Some(logs) = logs {
        out.push_str(&format!(
            "\nLOGS container={} previous={} error={:?}\n",
            logs.container, logs.previous, logs.error
        ));
        let start = logs.lines.len().saturating_sub(160);
        for line in &logs.lines[start..] {
            out.push_str(&format!(
                "{} {}\n",
                line.timestamp.clone().unwrap_or_default(),
                truncate(&line.text, 600)
            ));
        }
    }
    truncate(&out, 60_000)
}

fn parse_diagnosis(
    settings: &Settings,
    pod: &PodDetail,
    response: &AiResponse,
) -> Result<Diagnosis> {
    let parsed = extract_json(&response.content);
    let usage = response.usage.clone();
    let id = uuid::Uuid::new_v4().to_string();
    let Some(value) = parsed else {
        return Ok(Diagnosis {
            id,
            target: "Pod".into(),
            namespace: pod.pod.namespace.clone(),
            name: pod.pod.name.clone(),
            provider: settings.active_provider.clone(),
            model: response.model.clone(),
            summary: "The model did not return structured JSON; showing its raw analysis.".into(),
            severity: "warning".into(),
            root_cause: truncate(&response.content, 4000),
            confidence: 0.3,
            evidence: vec!["Model response was not valid JSON. Review the raw output.".into()],
            recommendations: Vec::new(),
            commands: Vec::new(),
            prevention: Vec::new(),
            created_at: now_iso(),
            usage,
            raw: Some(truncate(&response.content, 12_000)),
        });
    };
    let severity = value
        .get("severity")
        .and_then(Value::as_str)
        .unwrap_or("warning")
        .to_ascii_lowercase();
    let severity = match severity.as_str() {
        "critical" | "high" => "critical",
        "info" | "low" => "info",
        _ => "warning",
    }
    .to_string();
    let summary = value
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("Analysis complete")
        .to_string();
    let root_cause = value
        .get("rootCause")
        .or_else(|| value.get("root_cause"))
        .or_else(|| value.get("rootcause"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let confidence = value
        .get("confidence")
        .and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
        })
        .unwrap_or(0.5)
        .clamp(0.0, 1.0);
    let evidence = string_array(value.get("evidence"));
    let commands = string_array(value.get("commands"));
    let prevention = string_array(value.get("prevention"));
    let mut recommendations = Vec::new();
    if let Some(items) = value.get("recommendations").and_then(Value::as_array) {
        for item in items.iter().take(8) {
            let title = item
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Recommendation")
                .to_string();
            let detail = item
                .get("detail")
                .or_else(|| item.get("description"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let risk = item
                .get("risk")
                .and_then(Value::as_str)
                .unwrap_or("medium")
                .to_ascii_lowercase();
            let action = item
                .get("action")
                .filter(|v| !v.is_null())
                .and_then(|v| parse_action(v, pod, settings));
            recommendations.push(Recommendation {
                id: uuid::Uuid::new_v4().to_string(),
                title,
                detail,
                risk,
                action,
            });
        }
    }
    Ok(Diagnosis {
        id,
        target: "Pod".into(),
        namespace: pod.pod.namespace.clone(),
        name: pod.pod.name.clone(),
        provider: settings.active_provider.clone(),
        model: response.model.clone(),
        summary,
        severity,
        root_cause,
        confidence,
        evidence,
        recommendations,
        commands,
        prevention,
        created_at: now_iso(),
        usage,
        raw: Some(truncate(&response.content, 12_000)),
    })
}

fn extract_json(text: &str) -> Option<Value> {
    let t = text.trim();
    let t = t
        .strip_prefix("```json")
        .or_else(|| t.strip_prefix("```JSON"))
        .or_else(|| t.strip_prefix("```"))
        .unwrap_or(t)
        .trim();
    let t = t.strip_suffix("```").unwrap_or(t).trim();
    if let Ok(v) = serde_json::from_str::<Value>(t) {
        return Some(v);
    }
    let start = t.find('{')?;
    let end = t.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str::<Value>(&t[start..=end]).ok()
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => Vec::new(),
    }
}

fn parse_action(value: &Value, pod: &PodDetail, settings: &Settings) -> Option<ActionSpec> {
    let type_name = value
        .get("type")
        .and_then(Value::as_str)?
        .replace(['_', '-'], "")
        .to_ascii_lowercase();
    let namespace = value
        .get("namespace")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(&pod.pod.namespace);
    if namespace != pod.pod.namespace || settings.is_protected(namespace) {
        return None;
    }
    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or(&pod.owner.kind);
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(&pod.owner.name);
    match type_name.as_str() {
        "restartworkload" | "restart" => {
            if !matches!(kind, "Deployment" | "StatefulSet" | "DaemonSet") {
                return None;
            }
            if name != pod.owner.name || kind != pod.owner.kind {
                return None;
            }
            Some(ActionSpec::RestartWorkload {
                kind: kind.to_string(),
                namespace: namespace.to_string(),
                name: name.to_string(),
            })
        }
        "deletepod" | "delete" => {
            if !settings.safety.allow_destructive {
                return None;
            }
            if name != pod.pod.name {
                return None;
            }
            Some(ActionSpec::DeletePod {
                namespace: namespace.to_string(),
                name: name.to_string(),
            })
        }
        "patchimage" | "image" => {
            if !matches!(kind, "Deployment" | "StatefulSet" | "DaemonSet") {
                return None;
            }
            if name != pod.owner.name || kind != pod.owner.kind {
                return None;
            }
            let container = value.get("container").and_then(Value::as_str)?;
            let image = value.get("image").and_then(Value::as_str)?;
            if image.trim().is_empty() || image.chars().count() > 500 {
                return None;
            }
            Some(ActionSpec::PatchImage {
                kind: kind.to_string(),
                namespace: namespace.to_string(),
                name: name.to_string(),
                container: container.to_string(),
                image: image.to_string(),
            })
        }
        "patchresources" | "resources" => {
            if !matches!(kind, "Deployment" | "StatefulSet" | "DaemonSet") {
                return None;
            }
            if name != pod.owner.name || kind != pod.owner.kind {
                return None;
            }
            let container = value.get("container").and_then(Value::as_str)?;
            let resources =
                sanitize_resources(value.get("resources")?, settings.safety.max_memory_mi)?;
            Some(ActionSpec::PatchResources {
                kind: kind.to_string(),
                namespace: namespace.to_string(),
                name: name.to_string(),
                container: container.to_string(),
                resources,
            })
        }
        "scaleworkload" | "scale" => {
            if !matches!(kind, "Deployment" | "StatefulSet") {
                return None;
            }
            if name != pod.owner.name || kind != pod.owner.kind {
                return None;
            }
            let replicas = value.get("replicas").and_then(Value::as_i64).or_else(|| {
                value
                    .get("replicas")
                    .and_then(Value::as_str)
                    .and_then(|s| s.parse::<i64>().ok())
            })?;
            if !(0..=100).contains(&replicas) {
                return None;
            }
            Some(ActionSpec::ScaleWorkload {
                kind: kind.to_string(),
                namespace: namespace.to_string(),
                name: name.to_string(),
                replicas: replicas as i32,
            })
        }
        _ => None,
    }
}

fn sanitize_resources(value: &Value, max_mi: i64) -> Option<Value> {
    let obj = value.as_object()?;
    let mut out = serde_json::Map::new();
    for key in ["limits", "requests"] {
        let Some(map) = obj.get(key).and_then(Value::as_object) else {
            continue;
        };
        let mut clean = serde_json::Map::new();
        for (resource, raw) in map {
            if !matches!(resource.as_str(), "cpu" | "memory" | "ephemeral-storage") {
                continue;
            }
            let Some(s) = raw.as_str() else {
                continue;
            };
            if s.chars().count() > 40 {
                continue;
            }
            if resource == "cpu" && crate::models::parse_cpu_quantity(s) <= 0.0 {
                continue;
            }
            let mut value = s.to_string();
            if resource == "memory" {
                let bytes = crate::models::parse_memory_bytes(s);
                let cap = max_mi.max(64) as f64 * 1024.0 * 1024.0;
                if bytes > cap {
                    value = format!("{}Mi", max_mi.max(64));
                } else if bytes <= 0.0 {
                    continue;
                }
            }
            clean.insert(resource.clone(), Value::String(value));
        }
        if !clean.is_empty() {
            out.insert(key.to_string(), Value::Object(clean));
        }
    }
    if out.is_empty() {
        return None;
    }
    // Keep requests <= limits for memory.
    let limit_mem = out
        .get("limits")
        .and_then(Value::as_object)
        .and_then(|m| m.get("memory"))
        .and_then(Value::as_str)
        .map(crate::models::parse_memory_bytes);
    if let (Some(limit), Some(requests)) = (
        limit_mem,
        out.get_mut("requests").and_then(Value::as_object_mut),
    ) && let Some(request) = requests.get("memory").and_then(Value::as_str)
        && crate::models::parse_memory_bytes(request) > limit
    {
        requests.insert(
            "memory".into(),
            Value::String(format!("{}Mi", (limit / (1024.0 * 1024.0)).round() as i64)),
        );
    }
    Some(Value::Object(out))
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pod_fixture() -> PodDetail {
        let mut pod = PodDetail::default();
        pod.pod.namespace = "broken-apps".into();
        pod.pod.name = "crashing-pod".into();
        pod.owner.kind = "Deployment".into();
        pod.owner.name = "crashing-app".into();
        pod.owner.namespace = "broken-apps".into();
        pod
    }

    #[test]
    fn destructive_actions_require_opt_in() {
        let pod = pod_fixture();
        let mut settings = Settings::default();
        let delete = json!({"type": "delete_pod", "name": "crashing-pod"});

        assert!(parse_action(&delete, &pod, &settings).is_none());

        settings.safety.allow_destructive = true;
        assert!(matches!(
            parse_action(&delete, &pod, &settings),
            Some(ActionSpec::DeletePod { .. })
        ));
    }

    #[test]
    fn action_target_must_match_selected_pod() {
        let pod = pod_fixture();
        let settings = Settings::default();

        let wrong = json!({
            "type": "restart_workload",
            "kind": "Deployment",
            "name": "another-app"
        });
        assert!(parse_action(&wrong, &pod, &settings).is_none());

        let right = json!({
            "type": "restart_workload",
            "kind": "Deployment",
            "name": "crashing-app"
        });
        assert!(matches!(
            parse_action(&right, &pod, &settings),
            Some(ActionSpec::RestartWorkload { .. })
        ));
    }

    #[test]
    fn protected_namespaces_are_rejected() {
        let mut pod = pod_fixture();
        pod.pod.namespace = "kube-system".into();
        pod.owner.namespace = "kube-system".into();
        pod.owner.name = "coredns".into();

        let restart = json!({
            "type": "restart_workload",
            "kind": "Deployment",
            "name": "coredns"
        });
        assert!(parse_action(&restart, &pod, &Settings::default()).is_none());
    }

    #[test]
    fn scale_is_bounded() {
        let pod = pod_fixture();
        let settings = Settings::default();

        let too_many = json!({
            "type": "scale_workload",
            "kind": "Deployment",
            "name": "crashing-app",
            "replicas": 101
        });
        assert!(parse_action(&too_many, &pod, &settings).is_none());

        let valid = json!({
            "type": "scale_workload",
            "kind": "Deployment",
            "name": "crashing-app",
            "replicas": 3
        });
        assert!(matches!(
            parse_action(&valid, &pod, &settings),
            Some(ActionSpec::ScaleWorkload { replicas: 3, .. })
        ));
    }

    #[test]
    fn resource_patch_clamps_memory_and_keeps_requests_within_limits() {
        let raw = json!({
            "requests": {"memory": "2Gi", "cpu": "250m"},
            "limits": {"memory": "4Gi"}
        });
        let clean = sanitize_resources(&raw, 1024).expect("valid resources");
        assert_eq!(clean["requests"]["memory"].as_str(), Some("1024Mi"));
        assert_eq!(clean["limits"]["memory"].as_str(), Some("1024Mi"));
        assert_eq!(clean["requests"]["cpu"].as_str(), Some("250m"));

        let raw = json!({
            "requests": {"memory": "768Mi"},
            "limits": {"memory": "512Mi"}
        });
        let clean = sanitize_resources(&raw, 1024).expect("valid resources");
        assert_eq!(clean["requests"]["memory"].as_str(), Some("512Mi"));
    }

    #[test]
    fn resource_patch_rejects_only_invalid_resources() {
        let raw = json!({"requests": {"memory": "nope", "gpu": "1"}});
        assert!(sanitize_resources(&raw, 1024).is_none());
    }
}
