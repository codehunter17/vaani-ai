/* ============================================================
   VaaniAI · avatar-photoreal.js
   Photorealistic avatar tier via D-ID Streams:
   a real human face, streamed over WebRTC, lip-syncing the
   assistant's answers in real time. Pure REST + WebRTC — no SDK.
   Activated only when DID_API_KEY is set; otherwise the VRM 3D
   avatar remains. Every failure falls back gracefully.
   ============================================================ */

import { DID_API_KEY, DID_SOURCE_URL, DID_VOICE } from "./config.js";

const API = "https://api.d-id.com";
let pc = null, streamId = null, sessionId = null, videoEl = null, ready = false;

function auth() {
  const k = DID_API_KEY.trim();
  /* dashboard keys are "user:pass" — base64 them; already-encoded keys pass through */
  return "Basic " + (k.includes(":") ? btoa(k) : k);
}
function hdrs() { return { Authorization: auth(), "Content-Type": "application/json" }; }

export function photorealConfigured() { return Boolean(DID_API_KEY && DID_API_KEY.trim()); }
export function photorealReady() { return ready; }

export async function initPhotoreal() {
  if (!photorealConfigured()) return false;
  try {
    const r = await fetch(`${API}/talks/streams`, {
      method: "POST", headers: hdrs(),
      body: JSON.stringify({ source_url: DID_SOURCE_URL }),
    });
    if (!r.ok) throw new Error("stream create failed: " + r.status + " " + (await r.text()).slice(0, 120));
    const { id, offer, ice_servers, session_id } = await r.json();
    streamId = id; sessionId = session_id;

    pc = new RTCPeerConnection({ iceServers: ice_servers });
    pc.ontrack = (e) => attachVideo(e.streams[0]);
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      fetch(`${API}/talks/streams/${streamId}/ice`, {
        method: "POST", headers: hdrs(),
        body: JSON.stringify({
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
          session_id: sessionId,
        }),
      }).catch(() => {});
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const sr = await fetch(`${API}/talks/streams/${streamId}/sdp`, {
      method: "POST", headers: hdrs(),
      body: JSON.stringify({ answer, session_id: sessionId }),
    });
    if (!sr.ok) throw new Error("sdp exchange failed: " + sr.status);
    ready = true;
    return true;
  } catch (err) {
    console.warn("Photoreal avatar unavailable, keeping 3D avatar:", err);
    cleanup();
    return false;
  }
}

function attachVideo(stream) {
  const disc = document.querySelector(".avatar-disc");
  if (!videoEl) {
    videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = false;
    videoEl.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%";
  }
  videoEl.srcObject = stream;
  disc.querySelectorAll("svg,canvas").forEach((el) => (el.style.display = "none"));
  if (!videoEl.parentNode) disc.appendChild(videoEl);
}

/* Speak text through the photoreal face (D-ID does TTS + lip-sync). */
export async function photorealSpeak(text) {
  if (!ready) return false;
  try {
    const r = await fetch(`${API}/talks/streams/${streamId}`, {
      method: "POST", headers: hdrs(),
      body: JSON.stringify({
        script: {
          type: "text",
          input: text.slice(0, 900),
          provider: { type: "microsoft", voice_id: DID_VOICE },
        },
        config: { stitch: true },
        session_id: sessionId,
      }),
    });
    return r.ok;
  } catch (_) { return false; }
}

function cleanup() {
  try { if (pc) pc.close(); } catch (_) {}
  pc = null; streamId = null; sessionId = null; ready = false;
}
