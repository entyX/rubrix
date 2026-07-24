/**
 * D-034 — "how thoroughly should the judge watch?" — a user choice on the confirm screen.
 *
 * Kept in its own tiny module (no ffmpeg imports) so the confirm UI can render the options
 * without eagerly pulling the frame extractor's heavy dependencies.
 *
 * More frames = finer visual coverage (every slide change, more of each gesture) at the cost
 * of a longer IN-BROWSER extraction wait. It does NOT change the Gemini bill: frames go to
 * the OpenRouter vision model, and the judge reads only its text report. The frames ship to
 * /api/visual in batches of <=16, so a higher count never trips the single-request 502/
 * timeout wall.
 */
export type Thoroughness = 'standard' | 'deep' | 'max';

export interface ThoroughnessLevel {
  id: Thoroughness;
  label: string;
  /** short line under the label on the confirm screen */
  blurb: string;
  /** max stills sampled across the run */
  maxFrames: number;
  /** target seconds between stills */
  intervalS: number;
  /** in-browser extraction budget (ms) — higher levels need longer before they bail */
  budgetMs: number;
}

export const THOROUGHNESS: Record<Thoroughness, ThoroughnessLevel> = {
  standard: {
    id: 'standard',
    label: 'Standard',
    blurb: 'about 16 frames',
    maxFrames: 16,
    intervalS: 8,
    budgetMs: 35_000,
  },
  deep: {
    id: 'deep',
    label: 'Deep',
    blurb: 'about 32 frames · ~20s longer',
    maxFrames: 32,
    intervalS: 6,
    budgetMs: 70_000,
  },
  max: {
    id: 'max',
    label: 'Max — every second',
    blurb: '≈1 frame/sec, up to ~480 · +a few min',
    maxFrames: 480,
    intervalS: 1,
    budgetMs: 240_000,
  },
};

export const THOROUGHNESS_ORDER: Thoroughness[] = ['standard', 'deep', 'max'];
