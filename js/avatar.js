/* ============================================================
   VaaniAI · avatar.js
   Avatar state machine + viseme-style mouth control.
   States: idle | listening | thinking | speaking
   ============================================================ */

const MOUTH = {
  closed: "M86 126 Q100 132 114 126 Q100 134 86 126 Z",
  mid:    "M86 124 Q100 136 114 124 Q100 140 86 124 Z",
  open:   "M88 121 Q100 121 112 121 Q112 138 100 141 Q88 138 88 121 Z",
};

const stage = document.getElementById("stage");
const mouth = document.getElementById("mouth");
const pill  = document.getElementById("pipelinePill");

let mouthTimer = null;

export function setState(state) {
  stage.classList.remove("listening", "thinking", "speaking");
  if (state !== "idle") stage.classList.add(state);
  pill.textContent = state;
  pill.className = "pill" + (state === "listening" || state === "speaking" ? " live" : "");
}

/* Called while TTS is speaking: random viseme flapping (90 ms cadence)
   + word-boundary beats from tts.js for extra sync. */
export function startTalking() {
  stopTalking();
  mouthTimer = setInterval(() => {
    const r = Math.random();
    mouth.setAttribute("d", r < 0.34 ? MOUTH.closed : r < 0.7 ? MOUTH.mid : MOUTH.open);
  }, 90);
}

export function wordBeat() {
  mouth.setAttribute("d", Math.random() < 0.5 ? MOUTH.mid : MOUTH.open);
}

export function stopTalking() {
  clearInterval(mouthTimer);
  mouthTimer = null;
  mouth.setAttribute("d", MOUTH.closed);
}
