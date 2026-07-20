/**
 * Quote grounding — plan.md §9.7, the "non-negotiable" hallucination check.
 *
 * "Every transcript-sourced evidence.quote must be a substring of
 *  transcript.full_text (whitespace/case-normalized, >= 85% fuzzy match).
 *  Any failure -> strip the quote and drop that criterion's confidence one step."
 *
 * A judge that invents a quote is worse than no judge, so this is deliberately
 * strict and deliberately cheap to test.
 */

export const FUZZY_THRESHOLD = 0.85;

/** Case-fold, drop punctuation, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’`]/g, '') // don't let "don't"/"don’t" cost a match
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance, two-row DP. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Best similarity between `quote` and any same-length window of `haystack`.
 *
 * Exact (normalized) containment short-circuits to 1. Otherwise we slide a
 * word-window the size of the quote across the transcript. Windows whose length
 * is wildly different from the quote can't clear 0.85, so they're skipped —
 * that's what keeps this linear enough for a 20-minute transcript.
 */
export function bestMatchScore(quote: string, haystack: string): number {
  const nq = normalize(quote);
  const nh = normalize(haystack);
  if (nq === '') return 0;
  if (nh === '') return 0;
  if (nh.includes(nq)) return 1;

  const quoteWords = nq.split(' ');
  const hayWords = nh.split(' ');
  const w = quoteWords.length;
  if (w > hayWords.length) {
    // Quote is longer than the whole transcript — compare wholesale.
    return similarity(nq, nh);
  }

  let best = 0;
  // Vary the window a little: models trim or pad a word or two at the edges.
  for (const size of new Set([w, Math.max(1, w - 1), w + 1])) {
    if (size > hayWords.length) continue;
    for (let i = 0; i + size <= hayWords.length; i++) {
      const window = hayWords.slice(i, i + size).join(' ');
      // Cheap length prefilter: |len diff| / maxLen alone caps the achievable score.
      const lenRatio =
        Math.min(window.length, nq.length) / Math.max(window.length, nq.length);
      if (lenRatio < FUZZY_THRESHOLD) continue;

      const score = similarity(nq, window);
      if (score > best) best = score;
      if (best >= 0.999) return best;
    }
  }
  return best;
}

export function isGrounded(quote: string, transcriptFullText: string): boolean {
  return bestMatchScore(quote, transcriptFullText) >= FUZZY_THRESHOLD;
}

/**
 * Locate a quote in the transcript segments and return the START TIME of the segment
 * where it begins — or null if it can't be found.
 *
 * Why this exists (D-019): the model supplies `timestamp_start` for each evidence
 * quote, and it gets them wrong — sometimes badly. But every quote that survived the
 * grounding check above provably EXISTS in the transcript, so its true position is a
 * fact we can compute. §9.2's rule applies: numbers come from code, not the model.
 *
 * Works across segment boundaries: segments are joined word-wise (with a map from
 * word index -> segment) and the quote is matched exactly first, then fuzzily at
 * the same ≥85% bar the grounding check uses.
 */
export function findQuoteStart(
  quote: string,
  segments: Array<{ start: number; end: number; text: string }>,
): number | null {
  const quoteWords = normalize(quote).split(' ').filter(Boolean);
  if (quoteWords.length === 0 || segments.length === 0) return null;

  // Word-level corpus with a parallel map back to the owning segment.
  const words: string[] = [];
  const ownerSegment: number[] = [];
  for (let s = 0; s < segments.length; s++) {
    for (const w of normalize(segments[s].text).split(' ')) {
      if (w === '') continue;
      words.push(w);
      ownerSegment.push(s);
    }
  }
  if (words.length === 0) return null;

  // Pass 1: exact word-sequence match.
  outer: for (let i = 0; i + quoteWords.length <= words.length; i++) {
    for (let j = 0; j < quoteWords.length; j++) {
      if (words[i + j] !== quoteWords[j]) continue outer;
    }
    return segments[ownerSegment[i]].start;
  }

  // Pass 2: fuzzy window, same threshold and ±1-word wiggle as bestMatchScore.
  const nq = quoteWords.join(' ');
  let bestScore = 0;
  let bestIndex = -1;
  for (const size of new Set([quoteWords.length, Math.max(1, quoteWords.length - 1), quoteWords.length + 1])) {
    if (size > words.length) continue;
    for (let i = 0; i + size <= words.length; i++) {
      const window = words.slice(i, i + size).join(' ');
      const lenRatio = Math.min(window.length, nq.length) / Math.max(window.length, nq.length);
      if (lenRatio < FUZZY_THRESHOLD) continue;
      const score = similarity(nq, window);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
  }
  if (bestScore >= FUZZY_THRESHOLD && bestIndex >= 0) {
    return segments[ownerSegment[bestIndex]].start;
  }
  return null;
}

export type Confidence = 'high' | 'medium' | 'low';

/** plan.md §9.7: a stripped quote drops the criterion's confidence one step. */
export function dropConfidence(c: Confidence): Confidence {
  if (c === 'high') return 'medium';
  if (c === 'medium') return 'low';
  return 'low';
}
