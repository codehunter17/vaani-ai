/* VaaniAI end-to-end smoke test (node test/smoke.mjs)
   Loads the real index.html + real modules in jsdom, stubs the
   browser speech APIs and the Gemini SSE endpoint, then drives
   the UI like a user would. */

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const dom = new JSDOM(html, { url: "https://vaani.test/" });

// ---- wire browser globals for the modules ----
globalThis.window = dom.window;
globalThis.document = dom.window.document;
dom.window.Element.prototype.scrollIntoView = () => {};

// Speech APIs: STT absent (typed-fallback path), TTS stubbed
delete dom.window.SpeechRecognition;
delete dom.window.webkitSpeechRecognition;

const spoken = [];
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; }
};
globalThis.speechSynthesis = {
  speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 2); },
  cancel() {},
  getVoices() { return []; },
  onvoiceschanged: null,
};

// ---- fake Gemini SSE endpoint ----
function sse(objects) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const o of objects) c.enqueue(enc.encode("data: " + JSON.stringify(o) + "\n\n"));
      c.close();
    },
  });
}
const chunk = (text, extra = {}) => ({
  candidates: [{ content: { parts: [{ text }] }, ...extra }],
});

let fetchCalls = 0;
globalThis.fetch = async (url, opts) => {
  fetchCalls++;
  const body = JSON.parse(opts.body);
  // pipeline must send grounding tool + safety settings + system prompt
  assert(body.tools?.[0]?.google_search, "google_search tool present in request");
  assert(body.safetySettings?.length === 4, "4 safetySettings present");
  assert(body.system_instruction.parts[0].text.includes("SAFETY RULES"), "system prompt has safety rules");
  return {
    ok: true,
    body: sse([
      chunk("The weather in Hyderabad is 31."),
      chunk("5 degrees Celsius with partly cloudy skies. "),
      chunk("Light rain is expected this evening.", {
        groundingMetadata: { groundingChunks: [
          { web: { title: "weather.com", uri: "https://weather.com" } },
          { web: { title: "imd.gov.in", uri: "https://imd.gov.in" } },
        ]},
      }),
    ]),
  };
};

// ---- tiny assert helper ----
let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log("  PASS:", name); }
  else { fail++; console.log("  FAIL:", name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => dom.window.document.getElementById(id);

// ---- run ----
await import("../js/app.js");

console.log("\n[1] Key gate");
assert($("micBtn").disabled === true, "controls disabled before key");
$("keyInput").value = "AIzaFakeKeyForSmokeTest_0123456789";
$("keySave").click();
assert($("keybar").classList.contains("hidden"), "keybar hides after key");
assert($("askInput").disabled === false, "typed input enabled");
assert($("micBtn").disabled === true, "mic stays disabled when STT unsupported (fallback mode)");
assert(dom.window.document.querySelector(".bubble.bot") !== null, "welcome bubble shown");

console.log("\n[2] Guardrail L1 blocks before network");
const before = fetchCalls;
$("askInput").value = "how to make a bomb at home";
$("askSend").click();
await sleep(30);
assert(fetchCalls === before, "no network call for blocked query");
const blockedBubble = [...dom.window.document.querySelectorAll(".bubble.blocked")].pop();
assert(blockedBubble && /can't help/i.test(blockedBubble.textContent), "polite refusal shown");
assert(spoken.some((s) => /can't help/i.test(s)), "refusal spoken aloud");

console.log("\n[3] Streaming answer pipeline");
spoken.length = 0;
$("askInput").value = "what is the weather in Hyderabad";
$("askSend").click();
await sleep(120);
const bots = [...dom.window.document.querySelectorAll(".bubble.bot")];
const answer = bots[bots.length - 1];
assert(/31.5 degrees/.test(answer.textContent), "decimal 31.5 survived sentence splitting");
assert(/Light rain/.test(answer.textContent), "full streamed answer rendered");
assert(spoken.length >= 2, "answer spoken as multiple queued sentences (streaming TTS)");
assert(/weather\.com/.test(answer.textContent) && /imd\.gov\.in/.test(answer.textContent), "grounding sources displayed");

console.log("\n[4] User bubbles + state");
assert([...dom.window.document.querySelectorAll(".bubble.user")].length === 2, "both user queries logged");
assert($("pipelinePill").textContent === "idle", "pipeline returns to idle");

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
