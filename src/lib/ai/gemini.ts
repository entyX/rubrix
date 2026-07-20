/**
 * Gemini client wrapper — plan.md §9.8 (written for anthropic.ts; the contract is
 * provider-agnostic and is honoured here: timeout 120s, 2 retries with exponential
 * backoff on 429/5xx/timeout only, max output tokens sized to the schema, and a
 * per-call log of model / prompt_version / tokens / cost_cents / latency / run id).
 *
 * SERVER ONLY. Never import from a client component — it reads GEMINI_API_KEY.
 *
 * Why models.generateContent and not the newer interactions.create: on
 * gemini-2.5-flash the interactions API silently IGNORES response_format and
 * returns prose. generateContent + responseMimeType + responseSchema genuinely
 * enforces the schema. Verified 2026-07-12. See DECISIONS.md D-003.
 */
import { GoogleGenAI } from '@google/genai';
import {
  GEMINI_MODEL,
  COST_WARN_CENTS,
  OPENROUTER_FALLBACK_MODEL,
  costCents,
  type TokenUsage,
  ZERO_USAGE,
} from './models';
import { orGenerate, hasOpenRouter } from './openrouter';

/**
 * Thinking budgets, in tokens.
 *
 * gemini-2.5-flash uses thinkingBudget (a number). thinkingLevel is the Gemini 3.5+
 * mechanism and is rejected here with "Thinking level is not supported for this model"
 * — verified 2026-07-12. 0 disables thinking; -1 lets the model decide.
 *
 * This is a real cost lever: thought tokens bill at the OUTPUT rate ($2.50/1M).
 */
export const THINKING_BUDGET = {
  off: 0,
  light: 1024,
  standard: 4096,
} as const;

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set (see .env.example)');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

/**
 * Output token ceilings, sized to each schema (plan.md §9.8).
 *
 * ⚠️ On Gemini, THINKING TOKENS COUNT AGAINST maxOutputTokens. A 4,096-token thinking
 * budget plus a long JSON body will silently truncate mid-string and fail Zod if this
 * is set too low — which is exactly what an 8,000 cap did on a 16-criterion rubric.
 * Size `grade` for the biggest rubric we allow (40 criteria, §9.3) plus the budget.
 */
export const MAX_OUTPUT_TOKENS = {
  // A full rating sheet with 4 level descriptors per criterion is a LOT of JSON, and the
  // thinking budget is spent from the same allowance. 8k truncated real FBLA sheets
  // mid-string; don't lower this without doing the arithmetic.
  rubricParse: 24_000,
  grade: 32_000,
  qa: 8_000,
  practice: 2_000,
  transcribe: 24_000, // a 20-min run is a lot of verbatim text + timestamps
} as const;

export interface AudioPart {
  base64: string;
  mimeType: string;
}

export interface ImagePart {
  base64: string;
  mimeType: string;
  /** Shown to the model immediately before the image so it knows what it's looking at. */
  caption: string;
}

/** A PDF handed to the model whole. Gemini reads the rating-sheet TABLE far more
 *  reliably from the real document than from text flattened by a PDF extractor. */
export interface DocumentPart {
  base64: string;
  mimeType: string;
}

export interface GenerateArgs {
  system: string;
  user: string;
  responseSchema: unknown;
  maxOutputTokens: number;
  temperature: number;
  /** plan.md §9.7 consistency: a fixed seed makes reruns reproducible. */
  seed?: number;
  /** Tokens of thinking allowed. 0 = off. Thought tokens bill at the OUTPUT rate. */
  thinkingBudget?: number;
  audio?: AudioPart;
  /** Rendered screenshots. Without these, visual rubric criteria are not assessable. */
  images?: ImagePart[];
  /** A PDF (e.g. an official rating sheet) passed to the model intact. */
  document?: DocumentPart;
  /** For the log line, so a run can be traced end to end. */
  promptVersion: string;
  runId: string;
  label: string;
}

export interface GenerateResult {
  /** Raw model text. Still passes through §9.7 (fence strip + Zod) — never trusted. */
  text: string;
  usage: TokenUsage;
  costCents: number;
  latencyMs: number;
}

interface PromptTokenDetail {
  modality?: string;
  tokenCount?: number;
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/abort|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)) return true;
  const status = /\b(429|500|502|503|504)\b/.exec(msg);
  return status !== null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generate(args: GenerateArgs): Promise<GenerateResult> {
  let lastErr: unknown;
  // Thinking tokens spend from the same allowance as the JSON body, so a long grade
  // can hit the cap and truncate mid-string — which used to surface downstream as
  // "unusable JSON" on the student's run. On MAX_TOKENS we double the cap (bounded
  // by the model's 65,536 output ceiling) and retry instead.
  let outputCap = args.maxOutputTokens;
  const OUTPUT_CEILING = 65_536;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> =
        [];
      if (args.audio) {
        parts.push({ inlineData: { mimeType: args.audio.mimeType, data: args.audio.base64 } });
      }
      if (args.document) {
        parts.push({ inlineData: { mimeType: args.document.mimeType, data: args.document.base64 } });
      }
      for (const img of args.images ?? []) {
        parts.push({ text: img.caption });
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
      }
      parts.push({ text: args.user });

      const res = await ai().models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: args.system,
          temperature: args.temperature,
          ...(args.seed !== undefined ? { seed: args.seed } : {}),
          maxOutputTokens: outputCap,
          responseMimeType: 'application/json',
          responseSchema: args.responseSchema as never,
          ...(args.thinkingBudget !== undefined
            ? { thinkingConfig: { thinkingBudget: args.thinkingBudget } }
            : {}),
          abortSignal: controller.signal,
        },
      });

      const latencyMs = Date.now() - started;
      const m = res.usageMetadata;

      // Split prompt tokens by modality — audio bills at 3.3x text (see models.ts).
      const details: PromptTokenDetail[] = m?.promptTokensDetails ?? [];
      let audioIn = 0;
      for (const d of details) {
        if (d.modality === 'AUDIO') audioIn += d.tokenCount ?? 0;
      }
      const promptTotal = m?.promptTokenCount ?? 0;

      const usage: TokenUsage = {
        inputAudioTokens: audioIn,
        inputTextTokens: Math.max(0, promptTotal - audioIn),
        outputTokens: m?.candidatesTokenCount ?? 0,
        thoughtTokens: m?.thoughtsTokenCount ?? 0,
      };
      const cents = costCents(usage);

      // plan.md §9.8 per-call log.
      console.log(
        `[ai] run=${args.runId} ${args.label} model=${GEMINI_MODEL} pv=${args.promptVersion} ` +
          `in=${usage.inputTextTokens}t/${usage.inputAudioTokens}a out=${usage.outputTokens} ` +
          `thought=${usage.thoughtTokens} cost=${cents.toFixed(3)}c ${latencyMs}ms` +
          (attempt > 0 ? ` (retry ${attempt})` : ''),
      );
      if (cents > COST_WARN_CENTS) {
        console.warn(
          `[ai] COST WARNING: ${args.label} cost ${cents.toFixed(1)}c > ${COST_WARN_CENTS}c budget (plan.md §0)`,
        );
      }

      const finish = res.candidates?.[0]?.finishReason;
      const text = res.text;

      // Truncated JSON parses as garbage downstream — catch it HERE, name it, and
      // retry with a bigger allowance rather than failing the run on "unusable JSON".
      if (finish === 'MAX_TOKENS') {
        if (outputCap < OUTPUT_CEILING && attempt < MAX_RETRIES) {
          outputCap = Math.min(outputCap * 2, OUTPUT_CEILING);
          lastErr = new Error(`output truncated at ${finish}; raising cap to ${outputCap}`);
          console.warn(
            `[ai] run=${args.runId} ${args.label} hit MAX_TOKENS — retrying with maxOutputTokens=${outputCap}`,
          );
          continue;
        }
        throw new Error(
          `Gemini output was truncated at the ${outputCap}-token output cap (finish: MAX_TOKENS)`,
        );
      }

      if (!text) throw new Error(`Gemini returned no text (finish: ${finish})`);

      return { text, usage, costCents: cents, latencyMs };
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) break;
      console.warn(
        `[ai] run=${args.runId} ${args.label} attempt ${attempt + 1} failed, retrying: ` +
          `${(err as Error).message.split('\n')[0]}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  const lastMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);

  // Judge of last resort (D-018): if Gemini is out of quota/credit — the failure mode
  // "we don't have enough money on the Gemini key" — reroute this exact call to the
  // open-source model on OpenRouter instead of failing the student's run. Text and
  // image calls only (audio/PDF parts can't cross), loudly logged, and §9.7's
  // post-validation still runs on whatever comes back. Disable with RUBRIX_OSS_FALLBACK=off.
  const quotaDead = /\b429\b|RESOURCE_EXHAUSTED|quota|billing|payment|insufficient/i.test(lastMsg);
  if (
    quotaDead &&
    !args.audio &&
    !args.document &&
    hasOpenRouter() &&
    process.env.RUBRIX_OSS_FALLBACK !== 'off'
  ) {
    console.warn(
      `[ai] run=${args.runId} ${args.label} Gemini quota/billing failure — ` +
        `FALLING BACK to ${OPENROUTER_FALLBACK_MODEL} via OpenRouter`,
    );
    const or = await orGenerate({
      model: OPENROUTER_FALLBACK_MODEL,
      system: args.system,
      user: args.user,
      responseSchema: args.responseSchema,
      schemaName: args.label.replace(/[^a-z0-9_]/gi, '_'),
      maxOutputTokens: Math.min(args.maxOutputTokens, 32_000),
      temperature: args.temperature,
      seed: args.seed,
      images: args.images,
      promptVersion: args.promptVersion,
      runId: args.runId,
      label: `${args.label}:oss-fallback`,
    });
    return { text: or.text, usage: or.usage, costCents: or.costCents, latencyMs: or.latencyMs };
  }

  throw new Error(
    `Gemini call "${args.label}" failed after ${MAX_RETRIES + 1} attempts: ${lastMsg}`,
  );
}

export { ZERO_USAGE };
