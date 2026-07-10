/* ============================================================
   VaaniAI · recorder.js
   Fallback voice capture that does NOT depend on the device's
   speech service: record mic audio with MediaRecorder, convert
   to 16 kHz mono WAV in the browser, return base64 for
   Gemini-based transcription. Works on Android, iOS, Firefox.
   ============================================================ */

export const recSupported = Boolean(
  navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder
);

let mediaRec = null;
let chunks = [];
let stream = null;

export async function startRecording() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  mediaRec = new MediaRecorder(stream);
  mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  mediaRec.start();
}

export function isRecording() {
  return Boolean(mediaRec && mediaRec.state === "recording");
}

/* Stops the recorder and resolves to base64 WAV (16 kHz mono). */
export function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRec) return reject(new Error("not recording"));
    mediaRec.onstop = async () => {
      try {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mediaRec.mimeType || "audio/webm" });
        resolve(await blobToWavBase64(blob));
      } catch (err) { reject(err); }
      finally { mediaRec = null; stream = null; chunks = []; }
    };
    mediaRec.stop();
  });
}

async function blobToWavBase64(blob) {
  const raw = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  const decoded = await ac.decodeAudioData(raw);
  ac.close();

  /* resample + downmix to 16 kHz mono */
  const rate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * rate));
  const off = new OfflineAudioContext(1, frames, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return encodeWavBase64(rendered.getChannelData(0), rate);
}

function encodeWavBase64(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); wstr(8, "WAVE");
  wstr(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wstr(36, "data"); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
