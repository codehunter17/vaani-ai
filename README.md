# VaaniAI — Voice Assistant with Live Web Answers & Talking Avatar

> GCCWise AI/ML Intern Assignment · Krishna Kant (MCA, HBTU Kanpur)

Ask a question by voice ("what is the weather in Hyderabad?") — VaaniAI fetches
the answer live from the internet and **speaks it back through a lip-synced
avatar**, with layered safety guardrails that refuse offensive or inappropriate
queries.

## Quick start (2 minutes)

1. Get a free Gemini API key → https://aistudio.google.com/apikey
2. Give the app the key in any ONE of three ways:
   - **Demo link (recommended for sharing):** append it to the URL —
     `https://your-host/vaani-ai/#key=AIza...` — the key never enters the
     public repo, but anyone with the link gets a zero-setup demo
   - Paste it in the key box shown in the UI at runtime
   - Or hardcode it in `js/config.js` (only for private deployments)
3. Host the folder anywhere static — GitHub Pages, Netlify Drop, Vercel.
   *Note: the mic requires HTTPS, so open the hosted URL, not the local file.*
4. Open in Chrome/Edge, allow microphone, tap the mic and ask.
   No mic or non-Chromium browser? The typed input at the bottom works everywhere.

## Architecture

```
 ┌─────────┐   on-device    ┌──────────────┐  L1 input   ┌─────────────────────────┐
 │  Mic /  │ ─────────────▶ │  stt.js      │ ──filter──▶ │  llm.js                 │
 │  Typed  │  Web Speech    │  (STT)       │ guardrails  │  Gemini 2.5 Flash (SSE) │
 └─────────┘     API        └──────────────┘   .js       │  + Google Search        │
                                                          │  grounding (live web)   │
                                                          │  L2 safetySettings      │
        sentence-by-sentence, while the answer            │  L3 system prompt       │
        is still generating (streaming)                   └───────────┬─────────────┘
 ┌─────────────┐            ┌──────────────┐  L4 output               │
 │  avatar.js  │ ◀─visemes─ │  tts.js      │ ◀──filter────────────────┘
 │  lip-sync + │            │  sentence    │  guardrails.js
 │  states     │            │  queue TTS   │
 └─────────────┘            └──────────────┘
```

- **`js/config.js`** — the only file to edit: API key, model, prompts, safety thresholds
- **`js/guardrails.js`** — L1 input filter and L4 output filter (regex, on-device, zero latency)
- **`js/stt.js`** — on-device speech recognition (Web Speech API, `en-IN`)
- **`js/llm.js`** — streaming SSE client for Gemini with Google Search grounding; emits complete sentences as they form
- **`js/tts.js`** — sentence-queue TTS: speaks sentence 1 while sentences 2..n are still generating
- **`js/avatar.js`** — avatar state machine (idle/listening/thinking/speaking) + viseme mouth control
- **`js/app.js`** — orchestrator wiring the pipeline and the UI

No frameworks, no build step, no backend — plain ES modules on static hosting.

## Guardrails (defence-in-depth)

| Layer | Where | What it does |
|-------|-------|--------------|
| L1 | `guardrails.js`, on-device | Regex pre-filter (profanity EN+HI, violence, sexual, self-harm, hacking, drugs) blocks the query **before any network call** with a polite spoken refusal |
| L2 | Gemini `safetySettings` | `BLOCK_MEDIUM_AND_ABOVE` across harassment / hate / sexual / dangerous categories; blocks detected via `promptFeedback` / `finishReason` |
| L3 | System prompt | Refusal is the model's highest-priority instruction; borderline queries are declined without repeating harmful content |
| L4 | `guardrails.js`, on-device | Output screen: every generated sentence is re-checked before it is displayed or spoken |

## Latency engineering (implemented, not just proposed)

- **Streaming end-to-end**: `streamGenerateContent` (SSE) + a sentence queue —
  the avatar starts speaking the *first sentence* of the answer while the rest
  is still generating. Perceived latency ≈ time-to-first-sentence, not
  time-to-full-answer.
- **On-device STT and TTS** remove two network round-trips entirely.
- **Zero-cost guardrails**: L1/L4 run locally in microseconds.

## Tech choices — why

| Layer | Choice | Why |
|-------|--------|-----|
| STT | Web Speech API | Free, on-device (privacy + speed), instant partial results |
| LLM + live web | Gemini 2.5 Flash + Google Search grounding | One call does reasoning **and** real-time retrieval; fast Flash tier; free quota |
| TTS | SpeechSynthesis (`en-IN` voice) | Instant first audio, no second network hop |
| Avatar | SVG viseme lip-sync | Dependency-free now; drop-in upgrade path to photoreal WebRTC avatars (D-ID / HeyGen / MuseTalk) — see the one-pager report |

## What else is in the box

- **Grounding citations**: answers fetched from the live web show their sources
  ("Sources: weather.com · imd.gov.in") under the reply — visible proof of
  real-time retrieval.
- **Smoke test**: `npm install && npm test` runs an end-to-end test
  (`test/smoke.mjs`) that loads the real UI in jsdom, stubs the speech APIs and
  the Gemini SSE endpoint, and verifies the full pipeline: key gate, L1
  guardrail blocking before any network call, streaming sentence assembly
  (including decimals split across chunks), queued TTS, source display, and
  state resets. 17 assertions, all green.

## Demo queries

- "What is the weather in Hyderabad?"
- "Latest news headlines from India"
- "USD to INR exchange rate today"
- Try an inappropriate query — the assistant politely refuses (guardrails demo).
