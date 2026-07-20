/**
 * Groq Whisper client — the open-source EARS (DECISIONS D-018).
 *
 * SERVER ONLY. Reads GROQ_API_KEY.
 *
 * Why this exists: transcription was the single biggest Gemini cost (audio bills at
 * 3.3× text) AND the biggest JSON-failure source — an LLM writing a 20-minute verbatim
 * transcript as one giant JSON object truncates and drifts. Whisper is a real ASR
 * system: its segments and timestamps come from the audio itself, its output is
 * API-shaped rather than model-improvised, and on Groq it costs ~$0.11/hour.
 *
 * Optional: no GROQ_API_KEY → transcribe.ts uses the Gemini path unchanged.
 */
import { GROQ_WHISPER_MODEL, GROQ_WHISPER_USD_PER_HOUR } from './models';
import { transcriptFromSegments } from '@/lib/transcript/format';
import type { TranscriptJSON } from './schemas';

const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

export function hasGroq(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  no_speech_prob?: number;
}

interface WhisperVerboseJSON {
  text?: string;
  segments?: WhisperSegment[];
}

export interface GroqTranscribeResult {
  transcript: TranscriptJSON;
  costCents: number;
  latencyMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * bytes -> verbatim TranscriptJSON via whisper-large-v3.
 *
 * full_text is DERIVED from the segments (joined with single spaces), the same rule
 * the Gemini prompt states — one source of truth, so §9.7 grounding and the filler
 * metrics always agree with what the student sees quoted.
 */
export async function groqTranscribe(
  bytes: Buffer,
  mimeType: string,
  runId: string,
  durationS: number,
): Promise<GroqTranscribeResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set (see .env.example)');

  const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('m4a') ? 'm4a' : 'mp3';
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), `run.${ext}`);
  form.append('model', GROQ_WHISPER_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  // The delivery metrics count disfluencies — bias Whisper to keep them verbatim.
  form.append('prompt', 'Um, uh, so, you know, I mean — transcribe filler words and false starts verbatim.');

  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const err = new Error(`Groq ${res.status}: ${detail.slice(0, 200) || res.statusText}`);
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          lastErr = err;
          continue;
        }
        throw err;
      }

      const json = (await res.json()) as WhisperVerboseJSON;
      const latencyMs = Date.now() - started;

      // Whisper hallucinates phrases over silence; its own no_speech_prob flags them.
      const kept = (json.segments ?? []).filter((s) => (s.no_speech_prob ?? 0) <= 0.9);
      const transcript: TranscriptJSON = transcriptFromSegments(kept);
      const segments = transcript.segments;

      const cents = (durationS / 3600) * GROQ_WHISPER_USD_PER_HOUR * 100;
      console.log(
        `[ai] run=${runId} transcribe model=${GROQ_WHISPER_MODEL} ` +
          `${segments.length} segments · ${Math.round(durationS)}s audio · ` +
          `cost=${cents.toFixed(3)}c ${latencyMs}ms` +
          (attempt > 0 ? ` (retry ${attempt})` : ''),
      );

      return { transcript, costCents: cents, latencyMs };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/abort|timeout|ETIMEDOUT|ECONNRESET|fetch failed|Groq (429|5\d\d)/i.test(msg) || attempt === MAX_RETRIES) {
        break;
      }
      console.warn(`[ai] run=${runId} transcribe attempt ${attempt + 1} failed, retrying: ${msg.split('\n')[0]}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `Groq transcription failed after ${MAX_RETRIES + 1} attempts: ` +
      `${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}
