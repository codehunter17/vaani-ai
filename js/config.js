/* ============================================================
   VaaniAI · config.js
   The only file you need to edit before deploying.
   ============================================================ */

/* Paste your Gemini API key here before hosting the demo so
   reviewers don't need their own. Leave "" to show the key
   input box in the UI instead.
   Get a free key: https://aistudio.google.com/apikey        */
export const HARDCODED_API_KEY = "";

export const MODEL = "gemini-2.5-flash";

/* Streaming endpoint (SSE) — lets TTS start speaking the first
   sentence while the rest of the answer is still generating. */
const BASE = "https://generativelanguage.googleapis.com/v1beta";

export const STREAM_URL = (key) => `${BASE}/models/${MODEL}:streamGenerateContent?alt=sse&key=${key}`;

/* Non-streaming fallback for networks that stall SSE responses */
export const ONCE_URL = (key) => `${BASE}/models/${MODEL}:generateContent?key=${key}`;

/* Cheap metadata call used as a connectivity/key preflight check */
export const PING_URL = (key) => `${BASE}/models?pageSize=1&key=${key}`;

/* Abort a hung request after this long */
export const REQUEST_TIMEOUT_MS = 30000;

export const SYSTEM_PROMPT = `You are Vaani, a friendly Indian voice assistant. Your answers are SPOKEN aloud, so:
- Reply in 2 to 4 short conversational sentences. No markdown, no bullet points, no asterisks, no emojis.
- Use Google Search grounding for anything current: weather, news, sports scores, prices, facts.
- If the user speaks Hindi or Hinglish, reply in simple Hinglish.
- SAFETY RULES (highest priority): politely refuse any query that is offensive, hateful, sexual, violent, self-harm related, illegal, or asks for dangerous instructions. When refusing, say one short polite sentence like "Sorry, I can't help with that, but I'm happy to answer something else." Never repeat or describe the harmful content.`;

/* Rolling conversation window (user+model turns) kept for context */
export const HISTORY_LIMIT = 12;

export const GENERATION_CONFIG = { temperature: 0.4, maxOutputTokens: 512 };

/* Guardrail L2 — model-side safety thresholds */
export const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
];

/* ---- Photorealistic avatar tier (D-ID Streams) ----
   Get a free 14-day trial key (no card) at https://studio.d-id.com
   → API Keys. ~10 minutes of streaming video on trial.
   Leave "" to use the 3D VRM avatar instead. */
export const DID_API_KEY = "";
export const DID_SOURCE_URL = "https://d-id-public-bucket.s3.us-west-2.amazonaws.com/alice.jpg";
export const DID_VOICE = "en-IN-NeerjaNeural";
