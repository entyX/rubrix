/**
 * Deterministic delivery metrics — plan.md §9.2.
 *
 * "code, not the LLM — trustworthy, injected into grading."
 * "Time limits are checked in code, never by the LLM."
 *
 * Nothing here asks a model anything. Every number is computed from the transcript
 * segments and the real audio duration, so the judge can be told to trust them.
 */
import type { TranscriptJSON } from '@/lib/ai/schemas';

export interface DeliveryMetrics {
  duration_s: number;
  word_count: number;
  words_per_minute: number;
  filler_count: number;
  fillers_per_minute: number;
  longest_pause_s: number;
  time_limit_s: number | null;
  over_time: boolean | null;
  /** null in v1: transcription is not diarized, so we cannot attribute words to speakers. */
  speaker_balance: null;
  speaker_balance_note: string;
  /** Heuristic, not a verdict. See classifyDelivery(). */
  delivery_style: 'likely_reading' | 'likely_speaking' | 'unclear';
  delivery_style_note: string;
}

/** plan.md §9.2: um, uh, like, you know, sentence-initial so. */
const FILLER_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'um', re: /\bum+\b/g },
  { label: 'uh', re: /\buh+\b/g },
  { label: 'like', re: /\blike\b/g },
  { label: 'you know', re: /\byou know\b/g },
  // "so" only as an utterance-opener — the verbal tic, not the conjunction.
  // Fires at the start of the text, after sentence-ending punctuation, or after a
  // leading filler ("Um, so our plan is…"). Deliberately does NOT fire on a bare
  // comma, because "the market was small, so we pivoted" is ordinary English.
  { label: 'so (sentence-initial)', re: /(^|[.!?]\s+|\b(?:um+|uh+)\b[,\s]+)so\b/g },
];

export function countFillers(fullText: string): { total: number; byType: Record<string, number> } {
  const text = fullText.toLowerCase();
  const byType: Record<string, number> = {};
  let total = 0;
  for (const { label, re } of FILLER_PATTERNS) {
    const n = (text.match(re) ?? []).length;
    byType[label] = n;
    total += n;
  }
  return { total, byType };
}

export function countWords(fullText: string): number {
  const t = fullText.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

/** Largest silent gap between consecutive segments. */
export function longestPause(t: TranscriptJSON): number {
  let max = 0;
  for (let i = 1; i < t.segments.length; i++) {
    const gap = t.segments[i].start - t.segments[i - 1].end;
    if (gap > max) max = gap;
  }
  return Math.max(0, Number(max.toFixed(2)));
}

/**
 * Reading-vs-speaking heuristic (plan.md §9.2).
 * Read-aloud delivery is unusually *even*: very few fillers and near-constant pace.
 * Extemporaneous delivery varies. We measure the coefficient of variation of
 * per-segment WPM and combine it with the filler rate. This is a signal, not a
 * verdict — it is reported with its reasoning and never used to change a score.
 */
export function classifyDelivery(
  t: TranscriptJSON,
  fillersPerMin: number,
): { style: DeliveryMetrics['delivery_style']; note: string } {
  const rates: number[] = [];
  for (const s of t.segments) {
    const dur = s.end - s.start;
    if (dur < 1) continue; // too short to be meaningful
    rates.push((countWords(s.text) / dur) * 60);
  }
  if (rates.length < 4) {
    return { style: 'unclear', note: 'Too few usable segments to judge delivery style.' };
  }
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean <= 0) {
    return { style: 'unclear', note: 'Could not compute a pace.' };
  }
  const variance = rates.reduce((a, r) => a + (r - mean) ** 2, 0) / rates.length;
  const cv = Math.sqrt(variance) / mean;

  const evenPace = cv < 0.25;
  const fewFillers = fillersPerMin < 1.5;

  if (evenPace && fewFillers) {
    return {
      style: 'likely_reading',
      note: `Very even pace (variation ${(cv * 100).toFixed(0)}%) and few fillers (${fillersPerMin.toFixed(1)}/min) — this reads like a script being read aloud.`,
    };
  }
  if (!evenPace && !fewFillers) {
    return {
      style: 'likely_speaking',
      note: `Pace varies (${(cv * 100).toFixed(0)}%) with a natural filler rate (${fillersPerMin.toFixed(1)}/min) — this sounds spoken, not read.`,
    };
  }
  return {
    style: 'unclear',
    note: `Mixed signals: pace variation ${(cv * 100).toFixed(0)}%, fillers ${fillersPerMin.toFixed(1)}/min.`,
  };
}

export function computeDeliveryMetrics(
  transcript: TranscriptJSON,
  /** Real audio duration in seconds, read from the file — NOT from the model. */
  durationS: number,
  timeLimitS: number | null,
): DeliveryMetrics {
  const words = countWords(transcript.full_text);
  const minutes = durationS / 60;
  const fillers = countFillers(transcript.full_text);

  const wpm = minutes > 0 ? words / minutes : 0;
  const fpm = minutes > 0 ? fillers.total / minutes : 0;
  const { style, note } = classifyDelivery(transcript, fpm);

  return {
    duration_s: Number(durationS.toFixed(2)),
    word_count: words,
    words_per_minute: Number(wpm.toFixed(1)),
    filler_count: fillers.total,
    fillers_per_minute: Number(fpm.toFixed(2)),
    longest_pause_s: longestPause(transcript),
    time_limit_s: timeLimitS,
    over_time: timeLimitS === null ? null : durationS > timeLimitS,
    speaker_balance: null,
    speaker_balance_note:
      'Not measured: the transcript is not speaker-diarized, so words cannot be attributed to individual team members.',
    delivery_style: style,
    delivery_style_note: note,
  };
}
