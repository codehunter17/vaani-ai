/* ============================================================
   VaaniAI · guardrails.js
   Defence-in-depth:
   L1  client-side input filter  (this file, before any network call)
   L2  Gemini safetySettings     (config.js, enforced by the API)
   L3  system-prompt refusal     (config.js, model-level policy)
   L4  client-side output filter (this file, before anything is spoken)
   ============================================================ */

const BLOCK_PATTERNS = [
  /\b(kill|murder|attack|shoot|stab)\b.*\b(someone|people|him|her|them|myself)\b/i,
  /\b(how to (make|build).*(bomb|explosive|weapon|gun))\b/i,
  /\b(suicide|self[- ]?harm|end my life)\b/i,
  /\b(porn|nude|nudes|sexual|xxx|nsfw)\b/i,
  /\b(hack|ddos|phish|malware|ransomware)\b.*\b(account|website|wifi|phone|bank)\b/i,
  /\b(buy|sell|make)\b.*\b(drugs|cocaine|heroin|meth)\b/i,
  /\b(f\W?u\W?c\W?k|b\W?i\W?t\W?c\W?h|c\W?h\W?u\W?t|m\W?a\W?d\W?a\W?r|b\W?e\W?h\W?e\W?n\W?c)\w*/i,
];

export const REFUSAL_LINE =
  "Sorry, I can't help with that. It goes against my safety guidelines. Please ask me something else — I'm happy to help!";

/* L1: check the user's query before it leaves the device */
export function violatesInputGuardrail(text) {
  return BLOCK_PATTERNS.some((rx) => rx.test(text));
}

/* L4: check model output before it is displayed/spoken.
   Catches rare cases where a harmful phrase slips through L2/L3. */
export function violatesOutputGuardrail(text) {
  return BLOCK_PATTERNS.some((rx) => rx.test(text));
}
