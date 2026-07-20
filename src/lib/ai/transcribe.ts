/**
 * Transcription — plan.md §9.1. Output shape is always {full_text, segments}.
 *
 * Producer history: Whisper (spec) → Gemini (D-002, one key) → Whisper large-v3 via
 * Groq when GROQ_API_KEY is set, Gemini otherwise (D-018). D-002's escape hatch
 * ("swap transcription back to Whisper without touching the grader") is now real.
 *
 * PRIVACY (CLAUDE.md, non-negotiable): only audio is ever handled here. The
 * original video never reaches this module, this server, or any provider.
 */
import { parseBuffer } from 'music-metadata';
import { readFile } from 'node:fs/promises';
import { generate, MAX_OUTPUT_TOKENS, THINKING_BUDGET } from './gemini';
import { groqTranscribe, hasGroq } from './groq';
import {
  TRANSCRIBE_SYSTEM,
  TRANSCRIBE_USER,
  PROMPT_VERSION_TRANSCRIBE,
  validationRetryMessage,
} from './prompts';
import { TranscriptJSON, TranscriptModelJSON, TRANSCRIPT_RESPONSE_SCHEMA } from './schemas';
import { parseModelJson } from './json';
import { transcriptFromSegments } from '@/lib/transcript/format';
import { addUsage, ZERO_USAGE, type TokenUsage } from './models';

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

  // The EARS (D-018): Whisper via Groq when a key is present — a real ASR system,
  // with timestamps measured from the audio rather than estimated by an LLM, at
  // ~$0.11/audio-hour instead of Gemini's 3.3× audio token rate. Falls back to the
  // Gemini path below on any failure, so a Groq outage never fails a student's run.
  if (hasGroq()) {
    try {
      const g = await groqTranscribe(bytes, mimeType, runId, durationS);
      if (g.transcript.segments.length === 0 || g.transcript.full_text.trim() === '') {
        throw new Error('No intelligible speech found in that recording.');
      }
      const { transcript, warnings } = sanitizeSegments(g.transcript, durationS);
      return {
        transcript,
        durationS,
        usage: ZERO_USAGE, // token accounting is Gemini-specific; Whisper bills per audio hour
        costCents: g.costCents,
        timestampWarnings: warnings,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('No intelligible speech')) throw err; // a real verdict, not an outage
      console.warn(`[transcribe] run=${runId} Groq failed (${msg.split('\n')[0]}) — falling back to Gemini`);
    }
  }

  return geminiTranscribe(bytes, mimeType, runId, durationS);
}

/**
 * The Gemini path — used when no GROQ_API_KEY is set, or Groq is down.
 *
 * Hardened against the two "unusable JSON" failure modes video uploads kept hitting:
 * the model returns segments ONLY (full_text is derived in code — half the output
 * tokens, so long runs stop truncating at the cap), and a bad parse gets ONE
 * corrective retry (the same §9.7 loop grading has always had) instead of failing
 * the whole run on the first stumble.
 */
async function geminiTranscribe(
  bytes: Buffer,
  mimeType: string,
  runId: string,
  durationS: number,
): Promise<TranscribeResult> {
  let usage: TokenUsage = ZERO_USAGE;
  let cost = 0;
  let correction = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generate({
      system: TRANSCRIBE_SYSTEM,
      user: correction === '' ? TRANSCRIBE_USER : `${TRANSCRIBE_USER}\n\n${correction}`,
      responseSchema: TRANSCRIPT_RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS.transcribe,
      temperature: 0, // verbatim transcription: no creativity wanted at all
      seed: 7,
      thinkingBudget: THINKING_BUDGET.off, // nothing to deliberate about; thought tokens bill at the output rate
      audio: { base64: bytes.toString('base64'), mimeType },
      promptVersion: PROMPT_VERSION_TRANSCRIBE,
      runId,
      label: attempt === 0 ? 'transcribe' : 'transcribe:retry',
    });
    usage = addUsage(usage, res.usage);
    cost += res.costCents;

    const parsed = parseModelJson(res.text, TranscriptModelJSON);
    if (!parsed.ok) {
      if (attempt === 1) throw new Error(`Transcription returned unusable JSON: ${parsed.issues}`);
      // A retry doubles the cost of transcription — loud, never silent (D-010).
      console.warn(`[transcribe] run=${runId} schema retry — ${parsed.issues}`);
      correction = validationRetryMessage(parsed.issues);
      continue;
    }

    // full_text is DERIVED — one source of truth, always consistent with the
    // segments the student sees quoted (and with what §9.7 grounds against).
    const draft = transcriptFromSegments(parsed.value.segments);
    if (draft.segments.length === 0) {
      throw new Error('No intelligible speech found in that recording.');
    }
    const { transcript, warnings } = sanitizeSegments(draft, durationS);

    return { transcript, durationS, usage, costCents: cost, timestampWarnings: warnings };
  }

  // Unreachable — attempt 1 either returns or throws — but TypeScript can't see that.
  throw new Error('Transcription returned unusable JSON.');
}
