/* ============================================================
   VaaniAI · stt.js
   Speech-to-text via the on-device Web Speech API.
   Android hardening:
   1. Fresh recognition instance per session (reuse wedges).
   2. getUserMedia pre-warm before rec.start() — acquiring the
      mic stream first fixes the classic Android "starts then
      instantly ends" failure and forces a proper permission
      prompt.
   3. Synchronous `starting` guard against double-taps.
   4. onEnd reports WHY the session ended so failures are
      visible on screen, not silent.
   ============================================================ */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const sttSupported = Boolean(SR);

let callbacks = null;
let rec = null;
let active = false;
let starting = false;
let lastError = null;

export function initSTT(cb) { callbacks = cb; }

export async function startListening() {
  if (!SR || !callbacks || active || starting) return;
  starting = true;
  lastError = null;

  /* Pre-warm the microphone ONLY when we still need the permission
     prompt. When permission is already granted, acquiring and
     releasing the stream right before rec.start() can steal the
     audio route on Android — recognition then hears nothing. */
  let permState = "prompt";
  try {
    if (navigator.permissions && navigator.permissions.query) {
      permState = (await navigator.permissions.query({ name: "microphone" })).state;
    }
  } catch (_) {}

  if (permState !== "granted") {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        await new Promise((r) => setTimeout(r, 300));   // let the mic route settle
      }
    } catch (err) {
      starting = false;
      let code =
        err.name === "NotAllowedError" ? "not-allowed" :
        err.name === "NotFoundError"   ? "audio-capture" :
        err.name === "NotReadableError" ? "mic-busy" : (err.name || "mic-failed");
      if (code === "not-allowed" && permState === "denied") code = "not-allowed-site";
      callbacks.onError(code);
      return;
    }
  }

  rec = new SR();
  rec.lang = "en-IN";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => { starting = false; active = true; callbacks.onStart(); };
  rec.onresult = (e) => {
    let final = "", interim = "";
    for (const r of e.results) (r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript));
    if (interim) callbacks.onInterim(interim);
    if (final) callbacks.onFinal(final.trim());
  };
  rec.onerror = (e) => { starting = false; active = false; lastError = e.error; callbacks.onError(e.error); };
  rec.onend = () => {
    starting = false; active = false;
    callbacks.onEnd(lastError);
    lastError = null;
  };

  try {
    rec.start();
  } catch (err) {
    starting = false;
    callbacks.onError(err.name === "InvalidStateError" ? "busy-retry" : (err.name || "start-failed"));
  }
}

export function stopListening() {
  if (rec && (active || starting)) { try { rec.stop(); } catch (_) {} }
}

export function isListening() { return active || starting; }
