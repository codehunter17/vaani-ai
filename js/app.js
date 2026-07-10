/* ============================================================
   VaaniAI · app.js — orchestrator
   Pipeline:  Mic/Text → Guardrail L1 → Gemini stream (L2+L3)
              → Guardrail L4 → sentence-queued TTS + avatar
   ============================================================ */

import { HARDCODED_API_KEY } from "./config.js";
import { violatesInputGuardrail, violatesOutputGuardrail, REFUSAL_LINE } from "./guardrails.js";
import { setState, initVRMAvatar } from "./avatar.js";
import { initSTT, startListening, stopListening, isListening, sttSupported } from "./stt.js";
import { recSupported, startRecording, stopRecording, isRecording, watchSilence } from "./recorder.js";
import { beginUtterance, enqueue, endOfStream, cancelSpeech, isSpeaking } from "./tts.js";
import { askGeminiStream, preflight, transcribe } from "./llm.js";

/* Voice strategy: record-and-transcribe via Gemini is the DEFAULT.
   The native Web Speech API is unreliable in the field — on many
   Android devices it reports permission granted, then either throws
   'not-allowed' or hangs forever without ever firing a sound event.
   MediaRecorder + Gemini transcription works on every browser
   (Android, iOS, Firefox, desktop) and needs no OS speech service.
   Native recognition is kept as the fallback where recording is
   unavailable. */
let voiceMode = recSupported ? "rec" : (sttSupported ? "sr" : "none");
let recTimer = null;

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
  micBtn.disabled = voiceMode === "none";
  askInput.disabled = false;
  askSend.disabled = false;
  if (voiceMode === "none") {
    michint.textContent = "Voice not available on this browser — typed questions work below";
  } else if (voiceMode === "rec") {
    michint.textContent = "Tap the mic and speak";
  }
  setState("idle");
  setStatus('Tap the mic or a suggestion — try "what is the weather in Hyderabad"');
  if (!log.querySelector(".bubble")) {
    addBubble("Namaste! I'm Vaani. Ask me anything — weather, news, prices — and I'll fetch a live answer and speak it to you.", "bot");
  }
  /* Preflight: verify key + connectivity so problems are visible
     immediately instead of a silent hang on the first question. */
  preflight(apiKey).then((r) => {
    if (!r.ok) setStatus("Setup problem: " + r.msg, "err");
  });
}
if (apiKey) enableApp();
$("keySave").onclick = () => {
  const v = $("keyInput").value.trim();
  if (v.length < 20) { setStatus("That doesn't look like a valid key", "err"); return; }
  apiKey = v;
  enableApp();
};

/* ---------------- STT wiring ---------------- */
/* Load the 3D head in the background; the vector avatar shows
   instantly and stays if the model can't load. Open the app with
   #debug in the URL to see avatar-load errors on screen. */
initVRMAvatar("assets/model.vrm").then((ok) => {
  if (window.location.hash.includes("debug")) {
    setStatus(ok ? "3D avatar loaded" : "3D avatar failed — see console; vector fallback active", ok ? "live" : "err");
  }
});

const MIC_ERRORS = {
  "not-allowed": "Microphone blocked — tap the lock icon in the address bar → Permissions → Microphone → Allow, then reload",
  "not-allowed-site": "This SITE is set to Block in Chrome — tap the lock icon in the address bar → Permissions → Microphone → Allow (or Reset), then RELOAD the page",
  "not-allowed-os": "Chrome has site permission, but Android is blocking the mic — check Quick Settings mic toggle and Settings → Apps → Chrome → Permissions → Microphone",
  "service-not-allowed": "Speech service blocked — check Chrome's site permissions",
  "no-speech": "Didn't catch that — tap the mic and try again",
  "audio-capture": "No microphone found on this device",
  "mic-busy": "Microphone is in use by another app — close it and retry",
  "network": "Speech service unreachable — Android's speech recognition needs the Google app enabled and internet access",
  "busy-retry": "Mic was busy — tap once more",
  "aborted": "Mic was interrupted — tap to try again",
};

let micGotResult = false;

initSTT({
  onStart: () => {
    micGotResult = false;
    micBtn.classList.add("listening");
    setState("listening");
    setStatus("Listening…", "live");
  },
  onInterim: (t) => { micGotResult = true; setStatus("\u201C" + t + "\u201D", "live"); },
  onFinal: (t) => { micGotResult = true; handleQuery(t); },
  onError: (err) => {
    micBtn.classList.remove("listening");
    setState("idle");
    const msg = MIC_ERRORS[err] !== undefined ? MIC_ERRORS[err] : "Mic error: " + err;
    if (msg) setStatus(msg, err === "no-speech" || err === "busy-retry" ? "" : "err");
  },
  onEnd: (reason) => {
    micBtn.classList.remove("listening");
    if (!busy && !isSpeaking()) setState("idle");
    /* the mic closed without hearing anything and without a mapped
       error — say so instead of leaving a stale "Listening…" */
    if (!micGotResult && !reason && !busy) {
      if (recSupported) {
        voiceMode = "rec";
        michint.textContent = "Tap the mic and speak";
        setStatus("Speech service didn't respond — switched to recording mode. Tap the mic, speak, then tap again.", "");
      } else {
        setStatus("Mic closed without capturing audio — check the mic toggle in Quick Settings and Chrome's permissions", "err");
      }
    }
  },
});

micBtn.onclick = async () => {
  if (!apiKey || busy) return;
  if (isSpeaking()) stopAll();

  if (voiceMode === "rec") {
    if (isRecording()) { await finishRecording(); return; }
    try {
      await startRecording();
      micBtn.classList.add("listening");
      setState("listening");
      setStatus("Recording… speak now, it stops on its own", "live");
      recTimer = setTimeout(() => { if (isRecording()) finishRecording(); }, 15000);
      watchSilence(() => { if (isRecording()) finishRecording(); });
    } catch (err) {
      setStatus(err.name === "NotAllowedError"
        ? "Microphone blocked — tap the lock icon in the address bar → Permissions → Microphone → Allow, then reload"
        : "Could not start recording: " + (err.message || err), "err");
    }
    return;
  }

  if (isListening()) { stopListening(); return; }
  startListening();
};

async function finishRecording() {
  clearTimeout(recTimer);
  micBtn.classList.remove("listening");
  setState("thinking");
  setStatus("Transcribing…", "live");
  try {
    const b64 = await stopRecording();
    const text = await transcribe(apiKey, b64);
    if (text && text.length > 1) {
      handleQuery(text);
    } else {
      setState("idle");
      setStatus("Didn't catch any speech — tap the mic and try again");
    }
  } catch (err) {
    setState("idle");
    setStatus("Transcription failed: " + String(err.message || err).slice(0, 100), "err");
  }
}

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
    const detail = String(err.message || err).slice(0, 160);
    const msg = "Sorry, I couldn't get the answer. " + detail;
    addBubble(msg, "bot", true);
    setStatus(detail, "err");
    beginUtterance(() => setStatus("Tap the mic to try again"));
    enqueue("Sorry, I couldn't get the answer. Please try again.");
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
