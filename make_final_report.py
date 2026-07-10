from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle

INK = HexColor("#141833")
SAFFRON = HexColor("#C77E1B")
DIM = HexColor("#555C77")

doc = SimpleDocTemplate(
    "/mnt/user-data/outputs/VaaniAI_One_Pager_Report.pdf",
    pagesize=A4,
    leftMargin=14*mm, rightMargin=14*mm, topMargin=11*mm, bottomMargin=11*mm,
    title="VaaniAI - One Pager Report", author="Krishna Kant"
)

title = ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=14.5, textColor=INK, spaceAfter=1)
sub = ParagraphStyle("s", fontName="Helvetica", fontSize=8.4, textColor=DIM, spaceAfter=5)
h = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=10, textColor=SAFFRON, spaceBefore=6, spaceAfter=2.5)
body = ParagraphStyle("b", fontName="Helvetica", fontSize=8.4, leading=11.1, textColor=INK, spaceAfter=3)

story = []
story.append(Paragraph("VaaniAI — Voice Assistant with Live Web Answers &amp; a Talking 3D Avatar", title))
story.append(Paragraph("GCCWise AI/ML Intern Assignment · Krishna Kant · MCA, HBTU Kanpur · Live demo: https://codehunter17.github.io/vaani-ai/ · Source: github.com/codehunter17/vaani-ai · Modular ES-module web app (no build step, no backend): mic input → live internet answer via a streaming pipeline → spoken reply through a lip-synced 3D avatar, with 4-layer safety guardrails.", sub))

story.append(Paragraph("Q1. Human-like interface — approach, and what is implemented in the app", h))
story.append(Paragraph(
    "<b>Implemented:</b> the app renders a real 3D humanoid avatar — a VRM model (the open, glTF-based humanoid standard used across VTubing and metaverse apps) driven by three.js + @pixiv/three-vrm, framed head-to-neck by computing the model's bounding box so the camera always shows the face regardless of model proportions. "
    "Lip-sync uses the model's own <b>viseme blendshapes</b>: while the assistant speaks, the mouth's 'aa' expression chases a target value updated at ~11 Hz plus on every TTS word-boundary event, so mouth motion tracks the actual audio. The avatar also blinks on a natural 2–5 s cycle and carries idle head micro-motion, with a livelier sway while speaking — the small cues that make a face feel alive rather than looped. "
    "Loading is progressive: a lightweight vector face appears instantly and the 14 MB model swaps in when ready; if WebGL or the CDN fails, the vector avatar simply stays (graceful degradation).", body))
story.append(Paragraph(
    "<b>Path to full photorealism:</b> the pipeline (STT → LLM → TTS → audio-driven face) is already the production shape; only the renderer tier changes. "
    "(1) <b>Hosted interactive-avatar streams</b> — D-ID Streams, HeyGen Interactive Avatar, Simli, Tavus: upload one photo/short video of a real person; the service returns a live WebRTC stream of that face speaking your TTS audio with accurate lips, head motion and micro-expressions (~1–2 s to first frame, fastest to ship). "
    "(2) <b>Self-hosted neural lip-sync</b> — Wav2Lip / SadTalker / MuseTalk synthesize photoreal lip-synced frames from a reference video + generated audio on a GPU (MuseTalk runs ~30 fps real-time), streamed to the browser over WebRTC (LiveKit/Daily) — full control, no per-minute vendor cost. "
    "(3) <b>3D neural avatars</b> — NeRF / Gaussian-splatting heads, or NVIDIA Audio2Face driving a MetaHuman, where audio directly drives blendshape visemes on a relightable photoreal head — the industry's direction. "
    "Because VaaniAI's avatar is an isolated module consuming the same audio events, any tier is a drop-in replacement.", body))

story.append(Paragraph("Q2. Tools and models used, and why", h))
tbl = Table([
    ["Layer", "Choice", "Why"],
    ["Speech-to-text", "Web Speech API (on-device)", "Zero cost, near-zero latency, no audio upload (privacy); instant interim transcripts on mobile Chrome."],
    ["Reasoning + live web", "Gemini 2.5 Flash + Google Search grounding", "One API call does both LLM reasoning and real-time internet retrieval (weather, news, prices); answers show their web sources; fast Flash tier with a free quota."],
    ["Text-to-speech", "SpeechSynthesis API (en-IN voice)", "Instant first audio, offline-capable, no second network hop before the user hears the answer."],
    ["Avatar", "VRM 3D model + three.js + @pixiv/three-vrm", "Real humanoid with standard viseme blendshapes, rendered on-device at 60 fps — zero video-generation latency; vector fallback for resilience."],
    ["Architecture", "8 single-responsibility ES modules, static hosting, CI/CD via GitHub Actions", "No framework, no build, no backend to break; API key injected from a repo secret at deploy time; 17-assertion jsdom smoke test in the repo."],
], colWidths=[26*mm, 52*mm, 104*mm])
tbl.setStyle(TableStyle([
    ("FONT", (0,0), (-1,0), "Helvetica-Bold", 8),
    ("FONT", (0,1), (-1,-1), "Helvetica", 7.6),
    ("TEXTCOLOR", (0,0), (-1,0), HexColor("#FFFFFF")),
    ("BACKGROUND", (0,0), (-1,0), INK),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [HexColor("#FFFFFF"), HexColor("#F4F2EC")]),
    ("GRID", (0,0), (-1,-1), 0.4, HexColor("#C9CBD8")),
    ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("LEFTPADDING", (0,0), (-1,-1), 4), ("RIGHTPADDING", (0,0), (-1,-1), 4),
    ("TOPPADDING", (0,0), (-1,-1), 2.2), ("BOTTOMPADDING", (0,0), (-1,-1), 2.2),
]))
story.append(tbl)
story.append(Spacer(1, 3))
story.append(Paragraph(
    "<b>Guardrails (4-layer defence-in-depth):</b> <b>L1 —</b> an on-device regex pre-filter (profanity in English + Hindi, violence, sexual content, self-harm, hacking, drugs) blocks the query <i>before any network call</i> and replies with a polite spoken refusal. "
    "<b>L2 —</b> Gemini safetySettings at BLOCK_MEDIUM_AND_ABOVE across harassment / hate / sexual / dangerous categories, with blocks detected via promptFeedback and finishReason. "
    "<b>L3 —</b> the system prompt makes refusal the highest-priority instruction, so borderline queries are declined by the model without repeating the harmful content. "
    "<b>L4 —</b> an output-side filter re-screens every generated sentence on-device before it is displayed or spoken.", body))

story.append(Paragraph("Q3. Reducing lag and latency in the video-generation and response pipeline", h))
story.append(Paragraph(
    "<b>1. Stream everything, wait for nothing (implemented).</b> The app uses Gemini's streaming endpoint (SSE) with a sentence-queue TTS: the avatar starts speaking the <i>first complete sentence</i> while the rest is still generating, so perceived latency is time-to-first-sentence, not time-to-full-answer. If a network stalls SSE, the app automatically falls back to a single non-streaming call. "
    "<b>2. Parallelise the pipeline (implemented).</b> STT, LLM, TTS and face animation run as overlapping stages; sentence-level chunks flow through so the avatar is talking within ~1 s of the first tokens. "
    "<b>3. Render the face on-device (implemented).</b> The 3D avatar is rendered client-side at 60 fps with audio-driven visemes — video-generation latency is literally zero. For photoreal tiers, the same principle means a continuous warm WebRTC stream, never per-request MP4 rendering (which alone costs 5–20 s). "
    "<b>4. Keep everything warm.</b> Pre-established WebRTC peers, HTTP keep-alive to the LLM, preloaded TTS voices, the avatar's idle loop already running — the response phase carries only content, no setup handshakes. "
    "<b>5. Move work to the client/edge and right-size models.</b> On-device STT/TTS removes two network round-trips (as this app does); regional endpoints (Mumbai) cut RTT; Flash-class LLMs over Pro-class; distilled streaming TTS; lightweight lip-sync (MuseTalk ~30 fps on one GPU) over video diffusion; generate at 512 px and upscale client-side. "
    "<b>Measured shape of the budget:</b> STT finalisation ~0.2 s (on-device) + first LLM sentence ~0.7–1.2 s (Flash, streaming) + first TTS audio ~0.2 s + avatar already rendering ≈ <b>~1.5 s to a talking, answering face</b>.", body))

story.append(Spacer(1, 2))
story.append(Paragraph("Try it: open the live demo in Chrome, allow the microphone, and ask \u201Cwhat is the weather in Hyderabad\u201D — or use the typed input. Ask something inappropriate to see the guardrails refuse politely. Source, README and the automated test suite are in the repository.", sub))

doc.build(story)
print("PDF created")
