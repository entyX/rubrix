/**
 * D-034 — merge the per-batch visual reports back into one whole-run report.
 *
 * When a run is watched at Deep/Max thoroughness, the frames are analysed in batches of
 * <=16 (one /api/visual call each, to stay under the single-request 502/timeout wall).
 * Each batch returns a VisualReportJSON for the window of the run it saw; this stitches them:
 *   - observations are concatenated and time-ordered (the whole point — every moment kept);
 *   - each run-wide pattern field is the union of the batches' window descriptions, so more
 *     frames genuinely add detail rather than overwrite it;
 *   - video_quality and cannot_see are deduped.
 *
 * Pure — no I/O, imports only the type. Unit-tested. The merged object is a valid
 * VisualReportJSON, so §9.7 grounding (which renders it to text) works unchanged.
 */
import type { VisualReportJSON } from '@/lib/ai/schemas';

/**
 * A dense (Max, 1-fps, up to 660 frames ≈ 42 batches) run can yield many hundreds of
 * observations. Keep the report thorough but usable: cap the observation list and each pattern
 * field's union, downsampling evenly so what survives still spans the whole run. Raised for the
 * 660-frame Max so its extra detail actually reaches the judge; still bounded so the input can't
 * become a pathological wall of text.
 */
const MAX_OBSERVATIONS = 480;
const MAX_PATTERN_PARTS = 24;

/** Keep at most `cap`, evenly spread across the list (endpoints included). */
function evenSample<T>(xs: T[], cap: number): T[] {
  if (xs.length <= cap) return xs;
  return Array.from({ length: cap }, (_, k) => xs[Math.round((k * (xs.length - 1)) / (cap - 1))]);
}

/** Trim, drop empties, dedupe — preserving first-seen order. */
function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function mergeVisualReports(reports: VisualReportJSON[]): VisualReportJSON {
  const present = reports.filter((r): r is VisualReportJSON => Boolean(r));
  if (present.length === 0) throw new Error('mergeVisualReports: nothing to merge');
  if (present.length === 1) return present[0];

  const observations = evenSample(
    present.flatMap((r) => r.observations).slice().sort((a, b) => a.at_s - b.at_s),
    MAX_OBSERVATIONS,
  );

  const pattern = (pick: (p: VisualReportJSON['patterns']) => string): string =>
    uniq(present.map((r) => pick(r.patterns))).slice(0, MAX_PATTERN_PARTS).join(' ');

  return {
    video_quality: uniq(present.map((r) => r.video_quality)).join('; '),
    observations,
    patterns: {
      posture: pattern((p) => p.posture),
      gestures: pattern((p) => p.gestures),
      eye_line: pattern((p) => p.eye_line),
      attire: pattern((p) => p.attire),
      setting_and_aids: pattern((p) => p.setting_and_aids),
      movement: pattern((p) => p.movement),
    },
    cannot_see: uniq(present.flatMap((r) => r.cannot_see)),
  };
}
