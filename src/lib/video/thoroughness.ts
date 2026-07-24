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
    blurb: 'about 16 frames · fastest',
    maxFrames: 16,
    intervalS: 8,
    budgetMs: 35_000,
  },
  deep: {
    id: 'deep',
    label: 'Deep',
    blurb: 'about 48 frames · ~1 min longer',
    maxFrames: 48,
    intervalS: 4,
    budgetMs: 90_000,
  },
  max: {
    // D-036: honest ceiling. Literal 1-fps (D-035's 660) could not FINISH in-browser — hundreds
    // of sequential seeks overran the budget and returned nothing. 150 is the most stills a real
    // file reliably decodes in a few minutes; a frame every 2-3s on a typical run, ~10x Standard.
    id: 'max',
    label: 'Max detail',
    blurb: 'up to ~150 frames · a few min longer',
    maxFrames: 150,
    intervalS: 2,
    budgetMs: 240_000,
  },
};

export const THOROUGHNESS_ORDER: Thoroughness[] = ['standard', 'deep', 'max'];
