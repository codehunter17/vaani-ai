/* ============================================================
   VaaniAI · stt.js
   Speech-to-text via the on-device Web Speech API.
   Zero network round-trip, zero cost, instant partials.
   ============================================================ */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const sttSupported = Boolean(SR);

let rec = null;
let active = false;

export function initSTT({ onStart, onInterim, onFinal, onError, onEnd }) {
  if (!SR) return;
  rec = new SR();
  rec.lang = "en-IN";
  rec.interimResults = true;
  rec.continuous = false;

  rec.onstart = () => { active = true; onStart(); };
  rec.onresult = (e) => {
    let final = "", interim = "";
    for (const r of e.results) (r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript));
    if (interim) onInterim(interim);
    if (final) onFinal(final.trim());
  };
  rec.onerror = (e) => { active = false; onError(e.error); };
  rec.onend = () => { active = false; onEnd(); };
}

export function startListening() {
  if (!rec || active) return;
  try { rec.start(); } catch (_) { /* already starting */ }
}

export function stopListening() {
  if (rec && active) rec.stop();
}

export function isListening() { return active; }
