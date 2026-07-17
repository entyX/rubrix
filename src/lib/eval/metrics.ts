/**
 * Eval metrics — plan.md §10 ship-gate math. Pure functions, no I/O, so the harness's
 * OWN arithmetic is testable and trustworthy (a miscomputed r would be its own disaster).
 */

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Spread = max − min. §10 ship gate: run-to-run spread ≤ 3 pts. */
export function spread(xs: number[]): number {
  if (xs.length === 0) return 0;
  return Math.max(...xs) - Math.min(...xs);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Mean absolute error between paired series. §10: |AI − human| ≤ 8 pts on total. */
export function mae(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return NaN;
  return mean(a.map((x, i) => Math.abs(x - b[i])));
}

/**
 * Pearson correlation. §10 ship gate: total-score r ≥ 0.8 vs human consensus.
 * Returns NaN for < 2 points or zero variance (constant series) — the caller reports
 * that as "not computable", never as a passing 0.
 */
export function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n !== b.length || n < 2) return NaN;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}

export function inBand(pct: number, minPct: number, maxPct: number): boolean {
  return pct >= minPct - 1e-9 && pct <= maxPct + 1e-9;
}

/** Normalize for must_mention matching: casefold, collapse whitespace, drop punctuation. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9%.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * §10 must_mention: terms the grade should reference by name (specific methods, figures).
 * A term hits if it appears anywhere in the grade's prose (summary + justifications +
 * improvements + evidence). Returns hit count and the misses.
 */
export function mustMention(
  terms: string[],
  haystackParts: string[],
): { hits: number; total: number; missed: string[] } {
  const hay = norm(haystackParts.join('  '));
  const missed: string[] = [];
  for (const t of terms) {
    if (!hay.includes(norm(t))) missed.push(t);
  }
  return { hits: terms.length - missed.length, total: terms.length, missed };
}
