/* ============================================================
   VaaniAI · llm.js
   Streaming client for Gemini 2.5 Flash with Google Search
   grounding (live internet answers). Parses the SSE stream and
   emits COMPLETE SENTENCES as they form, so tts.js can start
   speaking before the full answer exists.
   ============================================================ */

import {
  STREAM_URL, SYSTEM_PROMPT, HISTORY_LIMIT,
  GENERATION_CONFIG, SAFETY_SETTINGS,
} from "./config.js";

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
export async function askGeminiStream(apiKey, userText, onSentence) {
  history.push({ role: "user", parts: [{ text: userText }] });
  if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: history,
    tools: [{ google_search: {} }],
    safetySettings: SAFETY_SETTINGS,
    generationConfig: GENERATION_CONFIG,
  };

  let res;
  try {
    res = await fetch(STREAM_URL(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    history.pop(); // don't leak the failed turn into the next request
    throw err;
  }

  if (!res.ok) {
    history.pop();
    if (res.status === 429) throw new Error("Rate limit reached — wait a few seconds and try again");
    if (res.status === 400 || res.status === 403) throw new Error("API key invalid or quota exceeded");
    throw new Error("API error " + res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = "";       // raw SSE lines
  let textBuf = "";      // sentence assembly buffer
  let fullText = "";
  let blocked = false;
  const sources = new Set();   // grounding citations (web page titles)

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
    const piece = (cand.content && cand.content.parts || [])
      .map((p) => p.text || "").join("");
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
    sseBuf = lines.pop(); // keep incomplete line
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try { handleChunk(JSON.parse(payload)); } catch (_) { /* partial JSON, ignore */ }
    }
    if (blocked) break;
  }

  /* flush any trailing partial sentence */
  const tail = textBuf.trim();
  if (!blocked && tail) { fullText += (fullText ? " " : "") + tail; onSentence(tail); }

  if (blocked || !fullText.trim()) {
    history.pop();
    return { fullText: "", blocked: true, sources: [] };
  }

  history.push({ role: "model", parts: [{ text: fullText }] });
  return { fullText, blocked: false, sources: [...sources] };
}
