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
