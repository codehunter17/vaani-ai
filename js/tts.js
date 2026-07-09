/* ============================================================
   VaaniAI · tts.js
   Text-to-speech with a SENTENCE QUEUE:
   the LLM stream pushes sentences here as they arrive, and the
   avatar starts speaking sentence 1 while sentences 2..n are
   still being generated — this is the main latency win.
   ============================================================ */

import { startTalking, stopTalking, wordBeat, setState } from "./avatar.js";

let queue = [];
let speaking = false;
let streamDone = true;
let onAllDone = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => /en[-_]IN/i.test(v.lang) && /female|neural|natural/i.test(v.name)) ||
    voices.find((v) => /en[-_]IN/i.test(v.lang)) ||
    voices.find((v) => /hi[-_]IN/i.test(v.lang)) ||
    voices.find((v) => /en[-_](GB|US)/i.test(v.lang)) ||
    voices[0]
  );
}

export function isSpeaking() { return speaking; }

/* Begin a new spoken answer. Sentences are fed via enqueue(). */
export function beginUtterance(allDoneCallback) {
  cancelSpeech();
  queue = [];
  streamDone = false;
  onAllDone = allDoneCallback;
}

export function enqueue(sentence) {
  const s = sentence.trim();
  if (!s) return;
  queue.push(s);
  if (!speaking) speakNext();
}

/* Call when the LLM stream has finished producing text. */
export function endOfStream() {
  streamDone = true;
  if (!speaking && queue.length === 0) finish();
}

function speakNext() {
  const s = queue.shift();
  if (s === undefined) {
    if (streamDone) finish();
    return;
  }
  speaking = true;
  setState("speaking");
  startTalking();

  const u = new SpeechSynthesisUtterance(s);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.0;
  u.pitch = 1.05;
  u.onboundary = wordBeat;
  u.onend = () => { speaking = false; speakNext(); };
  u.onerror = () => { speaking = false; speakNext(); };
  speechSynthesis.speak(u);
}

function finish() {
  speaking = false;
  stopTalking();
  setState("idle");
  if (onAllDone) { const cb = onAllDone; onAllDone = null; cb(); }
}

export function cancelSpeech() {
  queue = [];
  streamDone = true;
  speechSynthesis.cancel();
  speaking = false;
  stopTalking();
}

/* Chrome loads voices asynchronously */
if (typeof speechSynthesis !== "undefined") speechSynthesis.onvoiceschanged = () => {};
