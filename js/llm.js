/* ============================================================
   VaaniAI · llm.js
   Streaming client for Gemini 2.5 Flash with Google Search
   grounding (live internet answers). Parses the SSE stream and
   emits COMPLETE SENTENCES as they form, so tts.js can start
   speaking before the full answer exists.
   ============================================================ */

import {
  STREAM_URL, ONCE_URL, PING_URL, REQUEST_TIMEOUT_MS,
  SYSTEM_PROMPT, HISTORY_LIMIT,
  GENERATION_CONFIG, SAFETY_SETTINGS,
} from "./config.js";

/* Preflight: verify key + connectivity with a cheap metadata GET.
   Returns { ok, msg }. */
export async function preflight(apiKey) {
  try {
    const res = await fetch(PING_URL(apiKey), { signal: timeoutSignal(10000) });
    if (res.ok) return { ok: true, msg: "" };
    let msg = "HTTP " + res.status;
    try { msg = (await res.json()).error?.message || msg; } catch (_) {}
    return { ok: false, msg };
  } catch (err) {
    return { ok: false, msg: err.name === "AbortError"
      ? "Cannot reach Google's API — network may be blocking googleapis.com"
      : String(err.message || err) };
  }
}

function timeoutSignal(ms) {
  if (AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

let history = [];

export function resetHistory() { history = []; }

function cleanForSpeech(t) {
  return t
    .replace(/[*_#`>|]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s{2,}/g, " ");
}

/* Pull complete sentences off the front of a growing buffer.
   A sentence only counts as complete when its punctuation is
   followed by whitespace — never at the buffer's end, because a
   streamed chunk can cut mid-number ("...is 31." + "5 degrees").
   The final partial sentence is flushed when the stream ends. */
function drainSentences(buffer) {
  const out = [];
  let rest = buffer;
  let m;
  const rx = /^([\s\S]*?[.!?])\s+/;
  while ((m = rx.exec(rest)) && m[1].trim().length > 0) {
    const candidate = m[1];
    const after = rest.slice(m[0].length);
    /* extra guard for decimals written with a stray space */
    if (/\d[.]$/.test(candidate) && /^\d/.test(after)) break;
    out.push(candidate.trim());
    rest = after;
  }
  return { sentences: out, rest };
}

/**
 * Ask Gemini with streaming.
 * onSentence(s)  — called for each complete sentence as it forms
 * Returns { fullText, blocked }.
 */
function buildBody() {
  return {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: history,
    tools: [{ google_search: {} }],
    safetySettings: SAFETY_SETTINGS,
    generationConfig: GENERATION_CONFIG,
  };
}

async function throwHttpError(res) {
  let msg = "API error " + res.status;
  try { msg = (await res.json()).error?.message || msg; } catch (_) {}
  if (res.status === 429) msg = "Rate limit reached — wait a few seconds and try again";
  throw new Error(msg);
}

/**
 * Ask Gemini. Tries the streaming endpoint first; if the network
 * stalls or blocks SSE, automatically falls back to a single
 * non-streaming call. onSentence(s) fires per complete sentence.
 * Returns { fullText, blocked, sources, mode }.
 */
export async function askGeminiStream(apiKey, userText, onSentence) {
  history.push({ role: "user", parts: [{ text: userText }] });
  if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);

  let result;
  try {
    result = await tryStreaming(apiKey, onSentence);
  } catch (err) {
    const retriable = err.name === "AbortError" || err.name === "TypeError";
    if (!retriable) { history.pop(); throw err; }
    try {
      result = await tryOnce(apiKey, onSentence);   // SSE-blocked networks
    } catch (err2) {
      history.pop();
      throw new Error(err2.name === "AbortError"
        ? "Request timed out — check your internet connection"
        : (err2.message || String(err2)));
    }
  }

  if (result.blocked || !result.fullText.trim()) {
    history.pop();
    return { ...result, fullText: "", blocked: true };
  }
  history.push({ role: "model", parts: [{ text: result.fullText }] });
  return result;
}

async function tryStreaming(apiKey, onSentence) {
  const res = await fetch(STREAM_URL(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBody()),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) await throwHttpError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = "", textBuf = "", fullText = "";
  let blocked = false;
  const sources = new Set();

  const handleChunk = (json) => {
    if (json.promptFeedback && json.promptFeedback.blockReason) { blocked = true; return; }
    const cand = json.candidates && json.candidates[0];
    if (!cand) return;
    if (cand.finishReason === "SAFETY") { blocked = true; return; }
    const gm = cand.groundingMetadata;
    if (gm && gm.groundingChunks) {
      for (const g of gm.groundingChunks) {
        if (g.web && g.web.title && sources.size < 3) sources.add(g.web.title);
      }
    }
    const piece = (cand.content && cand.content.parts || []).map((p) => p.text || "").join("");
    if (!piece) return;
    textBuf += cleanForSpeech(piece);
    const { sentences, rest } = drainSentences(textBuf);
    textBuf = rest;
    for (const s of sentences) { fullText += (fullText ? " " : "") + s; onSentence(s); }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuf += decoder.decode(value, { stream: true });
    const lines = sseBuf.split("\n");
    sseBuf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try { handleChunk(JSON.parse(payload)); } catch (_) {}
    }
    if (blocked) break;
  }

  const tail = textBuf.trim();
  if (!blocked && tail) { fullText += (fullText ? " " : "") + tail; onSentence(tail); }
  return { fullText, blocked, sources: [...sources], mode: "stream" };
}

async function tryOnce(apiKey, onSentence) {
  const res = await fetch(ONCE_URL(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBody()),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) await throwHttpError(res);

  const data = await res.json();
  if (data.promptFeedback && data.promptFeedback.blockReason)
    return { fullText: "", blocked: true, sources: [], mode: "once" };
  const cand = data.candidates && data.candidates[0];
  if (!cand || cand.finishReason === "SAFETY" || !cand.content)
    return { fullText: "", blocked: true, sources: [], mode: "once" };

  const sources = [];
  const gm = cand.groundingMetadata;
  if (gm && gm.groundingChunks) {
    for (const g of gm.groundingChunks) {
      if (g.web && g.web.title && sources.length < 3) sources.push(g.web.title);
    }
  }
  let text = cleanForSpeech((cand.content.parts || []).map((p) => p.text || "").join(" ")).trim();
  const { sentences, rest } = drainSentences(text + " ");
  for (const s of sentences) onSentence(s);
  if (rest.trim()) onSentence(rest.trim());
  return { fullText: text, blocked: false, sources, mode: "once" };
}
