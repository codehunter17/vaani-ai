/* ============================================================
   VaaniAI · app.js — orchestrator
   Pipeline:  Mic/Text → Guardrail L1 → Gemini stream (L2+L3)
              → Guardrail L4 → sentence-queued TTS + avatar
   ============================================================ */

import { HARDCODED_API_KEY } from "./config.js";
import { violatesInputGuardrail, violatesOutputGuardrail, REFUSAL_LINE } from "./guardrails.js";
import { setState } from "./avatar.js";
import { initSTT, startListening, stopListening, isListening, sttSupported } from "./stt.js";
import { beginUtterance, enqueue, endOfStream, cancelSpeech, isSpeaking } from "./tts.js";
import { askGeminiStream } from "./llm.js";

const $ = (id) => document.getElementById(id);
const status_ = $("status"), micBtn = $("micBtn"), log = $("log"),
      stopBtn = $("stopSpeak"), michint = $("michint"),
      askInput = $("askInput"), askSend = $("askSend");

let apiKey = keyFromUrl() || HARDCODED_API_KEY;
let busy = false;

/* Demo-link pattern: append #key=YOUR_KEY to the URL to preload
   the API key without ever committing it to the public repo.
   Example: https://yoursite.github.io/vaani-ai/#key=AIza...     */
function keyFromUrl() {
  const m = window.location.hash.match(/key=([^&\s]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

/* ---------------- UI helpers ---------------- */
function setStatus(msg, cls) {
  status_.textContent = msg;
  status_.className = "status" + (cls ? " " + cls : "");
}
function addBubble(text, who, blocked) {
  const b = document.createElement("div");
  b.className = "bubble " + who + (blocked ? " blocked" : "");
  b.textContent = text;
  log.appendChild(b);
  b.scrollIntoView({ behavior: "smooth", block: "end" });
  return b;
}

/* ---------------- key handling ---------------- */
function enableApp() {
  $("keybar").classList.add("hidden");
  $("keynote").classList.add("hidden");
  micBtn.disabled = !sttSupported;
  askInput.disabled = false;
  askSend.disabled = false;
  if (!sttSupported) {
    michint.textContent = "Voice needs Chrome or Edge — typed questions work below";
  }
  setState("idle");
  setStatus('Tap the mic or a suggestion — try "what is the weather in Hyderabad"');
  if (!log.querySelector(".bubble")) {
    addBubble("Namaste! I'm Vaani. Ask me anything — weather, news, prices — and I'll fetch a live answer and speak it to you.", "bot");
  }
}
if (apiKey) enableApp();
$("keySave").onclick = () => {
  const v = $("keyInput").value.trim();
  if (v.length < 20) { setStatus("That doesn't look like a valid key", "err"); return; }
  apiKey = v;
  enableApp();
};

/* ---------------- STT wiring ---------------- */
initSTT({
  onStart: () => {
    micBtn.classList.add("listening");
    setState("listening");
    setStatus("Listening…", "live");
  },
  onInterim: (t) => setStatus("\u201C" + t + "\u201D", "live"),
  onFinal: (t) => handleQuery(t),
  onError: (err) => {
    micBtn.classList.remove("listening");
    setState("idle");
    if (err === "not-allowed") setStatus("Microphone permission needed — allow mic access and retry", "err");
    else if (err === "no-speech") setStatus("Didn't catch that — tap the mic and try again");
    else setStatus("Mic error: " + err, "err");
  },
  onEnd: () => {
    micBtn.classList.remove("listening");
    if (!busy && !isSpeaking()) setState("idle");
  },
});

micBtn.onclick = () => {
  if (!apiKey || busy) return;
  if (isSpeaking()) stopAll();
  if (isListening()) { stopListening(); return; }
  startListening();
};

/* ---------------- typed fallback + chips ---------------- */
function submitTyped() {
  const t = askInput.value.trim();
  if (!t || !apiKey || busy) return;
  askInput.value = "";
  if (isSpeaking()) stopAll();
  handleQuery(t);
}
askSend.onclick = submitTyped;
askInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitTyped(); });

document.querySelectorAll(".chip").forEach((c) => {
  c.onclick = () => {
    if (!apiKey || busy) return;
    if (isSpeaking()) stopAll();
    handleQuery(c.textContent);
  };
});

/* ---------------- stop control ---------------- */
function stopAll() {
  cancelSpeech();
  stopBtn.classList.add("hidden");
  michint.classList.remove("hidden");
  setState("idle");
}
stopBtn.onclick = () => { stopAll(); setStatus("Stopped. Ask me anything else."); };

/* ---------------- main pipeline ---------------- */
async function handleQuery(text) {
  stopListening();
  addBubble(text, "user");

  /* Guardrail L1 — blocked on-device, before any network call */
  if (violatesInputGuardrail(text)) {
    speakRefusal();
    return;
  }

  busy = true;
  micBtn.classList.add("busy");
  setState("thinking");
  setStatus("Fetching live answer…", "live");

  const botBubble = addBubble("…", "bot");
  let spokenAnything = false;

  beginUtterance(() => {
    /* all sentences finished speaking */
    stopBtn.classList.add("hidden");
    michint.classList.remove("hidden");
    setStatus("Tap the mic to ask another question");
  });

  try {
    const result = await askGeminiStream(apiKey, text, (sentence) => {
      /* Guardrail L4 — screen model output before speaking it */
      if (violatesOutputGuardrail(sentence)) return;
      if (!spokenAnything) {
        spokenAnything = true;
        botBubble.textContent = "";
        stopBtn.classList.remove("hidden");
        michint.classList.add("hidden");
      }
      botBubble.textContent += (botBubble.textContent ? " " : "") + sentence;
      botBubble.scrollIntoView({ behavior: "smooth", block: "end" });
      enqueue(sentence);
    });

    if (result.blocked || !spokenAnything) {
      botBubble.remove();
      speakRefusal();
    } else {
      /* show grounding citations — proof the answer came from the live web */
      if (result.sources && result.sources.length) {
        const s = document.createElement("div");
        s.className = "srcnote";
        s.textContent = "Sources: " + result.sources.join(" · ");
        botBubble.appendChild(s);
      }
      endOfStream();
    }
  } catch (err) {
    botBubble.remove();
    const msg = "Sorry, I couldn't reach the answer service. Please check your internet or API key and try again.";
    addBubble(msg, "bot", true);
    setStatus(String(err.message || err).slice(0, 120), "err");
    beginUtterance(() => setStatus("Tap the mic to try again"));
    enqueue(msg);
    endOfStream();
  } finally {
    busy = false;
    micBtn.classList.remove("busy");
  }
}

function speakRefusal() {
  addBubble(REFUSAL_LINE, "bot", true);
  beginUtterance(() => setStatus("Ask me something else — I'm happy to help"));
  enqueue(REFUSAL_LINE);
  endOfStream();
}
