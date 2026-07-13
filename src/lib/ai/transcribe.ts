/**
 * Transcription — plan.md §9.1, with the producer swapped from OpenAI Whisper to
 * Gemini (DECISIONS.md D-002). Output shape is unchanged: {full_text, segments}.
 *
 * PRIVACY (CLAUDE.md, non-negotiable): only audio is ever handled here. The
 * original video never reaches this module, this server, or Gemini.
 */
import { parseBuffer } from 'music-metadata';
import { readFile } from 'node:fs/promises';
import { generate, MAX_OUTPUT_TOKENS, THINKING_BUDGET } from './gemini';
import {
  TRANSCRIBE_SYSTEM,
  TRANSCRIBE_USER,
  PROMPT_VERSION_TRANSCRIBE,
} from './prompts';
import { TranscriptJSON, TRANSCRIPT_RESPONSE_SCHEMA } from './schemas';
import { parseModelJson } from './json';
import type { TokenUsage } from './models';

/** Inline request cap is 20MB total. Beyond that the Files API is required. */
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mp3',
  m4a: 'audio/m4a',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

export interface TranscribeResult {
  transcript: TranscriptJSON;
  /** Real duration read from the audio file itself — never from the model. */
  durationS: number;
  usage: TokenUsage;
  costCents: number;
  /** Timestamp sanity, surfaced so M1 can judge whether Gemini's timings are usable. */
  timestampWarnings: string[];
}

/**
 * Repairs and audits model-produced timestamps.
 *
 * §9.2's metrics (pauses, pacing) are only as good as these numbers, and an LLM's
 * self-reported timings drift in a way Whisper's do not. We clamp them to the real
 * duration, enforce monotonicity, and report anything we had to touch rather than
 * silently laundering bad data into a metric the judge is told to trust.
 */
function sanitizeSegments(t: TranscriptJSON, durationS: number): { transcript: TranscriptJSON; warnings: string[] } {
  const warnings: string[] = [];
  const segments = [...t.segments].sort((a, b) => a.start - b.start);

  let repaired = 0;
  let prevEnd = 0;
  for (const seg of segments) {
    if (seg.end < seg.start) {
      [seg.start, seg.end] = [seg.end, seg.start];
      repaired++;
    }
    if (seg.start < prevEnd) {
      seg.start = prevEnd;
      repaired++;
    }
    if (seg.end > durationS) {
      seg.end = durationS;
      repaired++;
    }
    if (seg.start > durationS) {
      seg.start = durationS;
      repaired++;
    }
    if (seg.end < seg.start) seg.end = seg.start;
    prevEnd = seg.end;
  }

  if (repaired > 0) {
    warnings.push(
      `${repaired} timestamp value(s) were out of order or past the end of the audio and had to be clamped.`,
    );
  }

  const covered = segments.reduce((acc, s) => acc + (s.end - s.start), 0);
  const coverage = durationS > 0 ? covered / durationS : 0;
  if (coverage < 0.5) {
    warnings.push(
      `Segments cover only ${(coverage * 100).toFixed(0)}% of the ${durationS.toFixed(0)}s recording — pause and pacing metrics may be unreliable.`,
    );
  }

  return { transcript: { full_text: t.full_text, segments }, warnings };
}

/** Convenience wrapper for the CLI. The web app uses transcribeAudio() directly. */
export async function transcribeAudioFile(path: string, runId: string): Promise<TranscribeResult> {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    throw new Error(`Unsupported audio type ".${ext}". Use one of: ${Object.keys(MIME_BY_EXT).join(', ')}.`);
  }
  return transcribeAudio(await readFile(path), mimeType, runId);
}

export async function transcribeAudio(
  bytes: Buffer,
  mimeType: string,
  runId: string,
): Promise<TranscribeResult> {
  if (bytes.byteLength > MAX_INLINE_BYTES) {
    throw new Error(
      `That audio is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB, which is over our upload limit. ` +
        `Try a shorter run — mono 64kbps mp3 keeps a 20-minute recording under 10MB.`,
    );
  }

  // Duration comes from the file, not the model. §9.2 requires this to be trustworthy.
  //
  // Sniff the container from the buffer's own magic bytes — don't pass a mimeType.
  // Browsers and OSes disagree about WAV ('audio/wav' vs 'audio/wave' vs 'audio/x-wav')
  // and a wrong label fails the whole run.
  //
  // NOTE: music-metadata is ESM-only and loads its container parsers via dynamic
  // import(). If this package ever loses "type": "module", those imports get rewritten
  // to require() and every parser silently disappears — the symptom is a bogus
  // "Guessed MIME-type not supported" on a perfectly valid file. Keep the package ESM.
  const meta = await parseBuffer(new Uint8Array(bytes));
  const durationS = meta.format.duration;
  if (!durationS || durationS <= 0) {
    throw new Error("We couldn't read how long that recording is. Try re-exporting it as an mp3.");
  }

  const maxMin = Number(process.env.MAX_VIDEO_MIN ?? 20);
  if (durationS > maxMin * 60) {
    throw new Error(
      `That recording is ${(durationS / 60).toFixed(1)} minutes. Practice runs need to be under ${maxMin} minutes.`,
    );
  }

  const res = await generate({
    system: TRANSCRIBE_SYSTEM,
    user: TRANSCRIBE_USER,
    responseSchema: TRANSCRIPT_RESPONSE_SCHEMA,
    maxOutputTokens: MAX_OUTPUT_TOKENS.transcribe,
    temperature: 0, // verbatim transcription: no creativity wanted at all
    seed: 7,
    thinkingBudget: THINKING_BUDGET.off, // nothing to deliberate about; thought tokens bill at the output rate
    audio: { base64: bytes.toString('base64'), mimeType },
    promptVersion: PROMPT_VERSION_TRANSCRIBE,
    runId,
    label: 'transcribe',
  });

  const parsed = parseModelJson(res.text, TranscriptJSON);
  if (!parsed.ok) {
    throw new Error(`Transcription returned unusable JSON: ${parsed.issues}`);
  }
  if (parsed.value.segments.length === 0 || parsed.value.full_text.trim() === '') {
    throw new Error('No intelligible speech found in that recording.');
  }

  const { transcript, warnings } = sanitizeSegments(parsed.value, durationS);

  return {
    transcript,
    durationS,
    usage: res.usage,
    costCents: res.costCents,
    timestampWarnings: warnings,
  };
}
