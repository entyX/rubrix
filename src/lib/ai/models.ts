/**
 * Model + pricing constants.
 *
 * plan.md §0 requires [VERIFY]-tagged pricing to be checked against the real world
 * and hardcoded as constants with a source-URL comment. Done below.
 *
 * Source: https://ai.google.dev/gemini-api/docs/pricing  (verified 2026-07-12)
 * Gemini 2.5 Flash, paid tier:
 *   input  $0.30 / 1M tokens  (text / image / video)
 *   input  $1.00 / 1M tokens  (audio)          <- 3.3x text; transcription is the cost driver
 *   output $2.50 / 1M tokens  (INCLUDES thinking/thought tokens)
 *
 * Audio token rate: 32 tokens per second of audio (1 min = 1,920 tokens).
 * Source: https://ai.google.dev/gemini-api/docs/audio (verified 2026-07-12)
 */

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

/**
 * Open-source pairing (DECISIONS D-018) — the judge stays Gemini, but the eyes and
 * ears are best-of-kind open models so the Gemini key only pays for judging:
 *
 *   Eyes: Qwen3-VL via OpenRouter — watches frames sampled across the WHOLE run.
 *     Source: https://openrouter.ai/qwen/qwen3-vl-235b-a22b-instruct (verified 2026-07-19)
 *     $0.20 / 1M input · $0.88 / 1M output. ~60 frames ≈ 1-2¢.
 *   Ears: Whisper large-v3 via Groq — transcription with real ASR timestamps.
 *     Source: https://groq.com/pricing (verified 2026-07-19)
 *     $0.111 / audio hour (whisper-large-v3). A 15-min run ≈ 0.03¢.
 *
 * Both are OPTIONAL: no OPENROUTER_API_KEY / GROQ_API_KEY → the old Gemini-only
 * paths run unchanged.
 */
// The EYES: the 32B is the observer sweet spot — it describes frames just as reliably as
// the 235B but returns in a fraction of the time (D-030). The 235B with a stack of images
// was slow enough to blow a serverless function's time limit ("terminated"), and describing
// posture/attire in stills does not need a frontier model. Override via env if you want.
export const OPENROUTER_VISION_MODEL =
  process.env.OPENROUTER_VISION_MODEL ?? 'qwen/qwen3-vl-32b-instruct';
/** Judge-of-last-resort when Gemini itself is out of quota/credit. JUDGING is harder than
 *  observing, so this stays on the big model — it runs rarely and only text+images. */
export const OPENROUTER_FALLBACK_MODEL =
  process.env.OPENROUTER_FALLBACK_MODEL ?? 'qwen/qwen3-vl-235b-a22b-instruct';
export const GROQ_WHISPER_MODEL = process.env.GROQ_WHISPER_MODEL ?? 'whisper-large-v3';

/** Fallback estimate when OpenRouter's own usage.cost is missing from a response. */
export const OPENROUTER_PRICING_USD_PER_1M = { input: 0.2, output: 0.88 } as const;
export const GROQ_WHISPER_USD_PER_HOUR = 0.111;

export const PRICING_USD_PER_1M = {
  inputText: 0.3,
  inputAudio: 1.0,
  output: 2.5, // thought tokens bill at this rate too
} as const;

/** plan.md §0: console-warn if any single graded run exceeds this. */
export const COST_WARN_CENTS = 75;
/** plan.md §0: target average cost per graded run. */
export const COST_TARGET_CENTS = 30;

export interface TokenUsage {
  inputTextTokens: number;
  inputAudioTokens: number;
  outputTokens: number;
  thoughtTokens: number;
}

/**
 * Cost in cents. Thought tokens bill at the output rate (see pricing source above),
 * so they are added to outputTokens rather than tracked as free.
 */
export function costCents(u: TokenUsage): number {
  const usd =
    (u.inputTextTokens * PRICING_USD_PER_1M.inputText) / 1_000_000 +
    (u.inputAudioTokens * PRICING_USD_PER_1M.inputAudio) / 1_000_000 +
    ((u.outputTokens + u.thoughtTokens) * PRICING_USD_PER_1M.output) / 1_000_000;
  return usd * 100;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTextTokens: a.inputTextTokens + b.inputTextTokens,
    inputAudioTokens: a.inputAudioTokens + b.inputAudioTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thoughtTokens: a.thoughtTokens + b.thoughtTokens,
  };
}

export const ZERO_USAGE: TokenUsage = {
  inputTextTokens: 0,
  inputAudioTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
};
