/* ============================================================
   VaaniAI · stt.js
   Speech-to-text via the on-device Web Speech API.
   A FRESH recognition instance is created for every session:
   reusing one instance wedges silently on Android Chrome after
   an error or abnormal end — the classic "mic does nothing" bug.
   ============================================================ */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const sttSupported = Boolean(SR);

let callbacks = null;
let rec = null;
let active = false;

export function initSTT(cb) { callbacks = cb; }

export function startListening() {
  if (!SR || !callbacks || active) return;

  rec = new SR();
  rec.lang = "en-IN";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => { active = true; callbacks.onStart(); };
  rec.onresult = (e) => {
    let final = "", interim = "";
    for (const r of e.results) (r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript));
    if (interim) callbacks.onInterim(interim);
    if (final) callbacks.onFinal(final.trim());
  };
  rec.onerror = (e) => { active = false; callbacks.onError(e.error); };
  rec.onend = () => { active = false; callbacks.onEnd(); };

  try {
    rec.start();
  } catch (err) {
    active = false;
    /* surface instead of swallowing — a silent catch here is
       exactly how "tap does nothing" bugs are born */
    callbacks.onError(err.name === "InvalidStateError" ? "busy-retry" : (err.name || "start-failed"));
  }
}

export function stopListening() {
  if (rec && active) { try { rec.stop(); } catch (_) {} }
}

export function isListening() { return active; }
