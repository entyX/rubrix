/**
 * OpenRouter client — the open-source half of the pipeline (DECISIONS D-018).
 *
 * SERVER ONLY. Never import from a client component — it reads OPENROUTER_API_KEY.
 *
 * Same contract as gemini.ts (§9.8): 120s timeout, 2 retries with exponential backoff
 * on 429/5xx/timeout only, and a per-call log of model / prompt_version / tokens /
 * cost_cents / latency / run id. Output is never trusted — §9.7's fence-strip + Zod +
 * retry runs on top exactly as it does for Gemini.
 *
 * Two jobs:
 *   1. The EYES: Qwen3-VL reads every sampled frame of the run and writes the visual
 *      delivery report (src/lib/ai/visual.ts).
 *   2. Judge of last resort: when the Gemini key is out of quota/credit, gemini.ts
 *      routes the same call here rather than failing the student's grade.
 */
import {
  OPENROUTER_PRICING_USD_PER_1M,
  ZERO_USAGE,
  type TokenUsage,
} from './models';
import type { ImagePart } from './gemini';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Measured: 6 frames ≈ 37s on the 235B vision model. A whole-run batch (up to 60)
// needs more headroom than gemini.ts's 120s; /api/visual allows 300s total.
const TIMEOUT_MS = 180_000;
const MAX_RETRIES = 2;

export function hasOpenRouter(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export interface ORGenerateArgs {
  model: string;
  system: string;
  user: string;
  /** JSON Schema for response_format json_schema. Best-effort on the provider side —
   *  the caller's Zod parse is the real gate, same rule as Gemini's responseSchema. */
  responseSchema: unknown;
  schemaName: string;
  maxOutputTokens: number;
  temperature: number;
  seed?: number;
  images?: ImagePart[];
  promptVersion: string;
  runId: string;
  label: string;
}

export interface ORGenerateResult {
  text: string;
  usage: TokenUsage;
  costCents: number;
  latencyMs: number;
  model: string;
}

interface ORResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; code?: number };
}

function isRetryable(status: number | null, err: unknown): boolean {
  if (status !== null) return status === 429 || status >= 500;
  const msg = err instanceof Error ? err.message : String(err);
  return /abort|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function orGenerate(args: ORGenerateArgs): Promise<ORGenerateResult> {
  // .trim(): a trailing newline on a pasted Vercel env var makes the Authorization
  // header invalid and OpenRouter answers "Missing Authentication header" (401).
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set (see .env.example)');

  type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };
  const content: ContentPart[] = [];
  for (const img of args.images ?? []) {
    content.push({ type: 'text', text: img.caption });
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    });
  }
  content.push({ type: 'text', text: args.user });

  const body = JSON.stringify({
    model: args.model,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content },
    ],
    temperature: args.temperature,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
    max_tokens: args.maxOutputTokens,
    response_format: {
      type: 'json_schema',
      json_schema: { name: args.schemaName, strict: false, schema: args.responseSchema },
    },
    // Only route to providers that actually honour response_format — a provider that
    // silently drops it fails as a wrong grade, not as an error (same trap as D-003).
    provider: { require_parameters: true },
    usage: { include: true },
  });

  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let status: number | null = null;

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://rubrix.app',
          'X-Title': 'Rubrix',
        },
        body,
        signal: controller.signal,
      });
      status = res.status;
      const json = (await res.json()) as ORResponse;

      if (!res.ok || json.error) {
        throw new Error(
          `OpenRouter ${res.status}: ${json.error?.message ?? res.statusText ?? 'request failed'}`,
        );
      }

      const text = json.choices?.[0]?.message?.content ?? '';
      const finish = json.choices?.[0]?.finish_reason;
      if (!text) throw new Error(`OpenRouter returned no text (finish: ${finish ?? 'unknown'})`);
      if (finish === 'length') {
        // Truncated JSON is a wrong grade waiting to happen — fail loudly instead.
        throw new Error(
          `OpenRouter output hit the ${args.maxOutputTokens}-token cap and was truncated (finish: length)`,
        );
      }

      const latencyMs = Date.now() - started;
      const usage: TokenUsage = {
        inputTextTokens: json.usage?.prompt_tokens ?? 0,
        inputAudioTokens: 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        thoughtTokens: 0,
      };
      // OpenRouter reports the real charge in USD when usage.include is set; fall back
      // to a pricing-table estimate if a provider omits it.
      const cents =
        json.usage?.cost !== undefined
          ? json.usage.cost * 100
          : ((usage.inputTextTokens * OPENROUTER_PRICING_USD_PER_1M.input +
              usage.outputTokens * OPENROUTER_PRICING_USD_PER_1M.output) /
              1_000_000) *
            100;

      console.log(
        `[ai] run=${args.runId} ${args.label} model=${args.model} pv=${args.promptVersion} ` +
          `in=${usage.inputTextTokens}t out=${usage.outputTokens} ` +
          `cost=${cents.toFixed(3)}c ${latencyMs}ms` +
          (attempt > 0 ? ` (retry ${attempt})` : ''),
      );

      return { text, usage, costCents: cents, latencyMs, model: args.model };
    } catch (err) {
      lastErr = err;
      if (!isRetryable(status, err) || attempt === MAX_RETRIES) break;
      console.warn(
        `[ai] run=${args.runId} ${args.label} attempt ${attempt + 1} failed, retrying: ` +
          `${(err as Error).message.split('\n')[0]}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `OpenRouter call "${args.label}" failed after ${MAX_RETRIES + 1} attempts: ` +
      `${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

export { ZERO_USAGE };
