import type { TranscriptJSON } from '@/lib/ai/schemas';

/** Seconds -> "mm:ss" (or "h:mm:ss" past an hour). */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** plan.md §9.5: "TRANSCRIPT (one line per segment): [mm:ss] text ..." */
export function formatTranscriptLines(t: TranscriptJSON): string {
  return t.segments.map((s) => `[${mmss(s.start)}] ${s.text}`).join('\n');
}

/** Rough token estimate (~4 chars/token). plan.md §9.5 fails a transcript over ~60k tokens. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const MAX_TRANSCRIPT_TOKENS = 60_000;
