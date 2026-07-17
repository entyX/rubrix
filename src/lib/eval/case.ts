/**
 * Eval case format — plan.md §10.
 *
 * A case is a FIXED input (rubric + transcript, optionally frames/site/qa) plus an
 * `expected` band, so the grader is evaluated in isolation from transcription variance.
 * Grading is run against the stored transcript, never re-transcribed.
 *
 *   scripts/eval-cases/{name}/
 *     case.json         <- this shape
 *     transcript.json   <- TranscriptJSON (referenced by case.inputs.transcript)
 */
import { z } from 'zod';
import { TranscriptJSON } from '@/lib/ai/schemas';

export const EvalCase = z.object({
  name: z.string(),
  event: z.string(),
  org: z.string().default('fbla'),
  /** Path under rubrics/ to a CONFIRMED rubric. */
  rubricRef: z.string(),
  durationS: z.number().positive(),
  timeLimitS: z.number().nullable().default(null),
  teamSize: z.number().default(1),

  inputs: z.object({
    transcript: z.string().default('transcript.json'),
    qa: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  }),

  expected: z.object({
    score_min_pct: z.number(),
    score_max_pct: z.number(),
    tier: z.enum([
      'needs_work',
      'competitive_regional',
      'competitive_state',
      'competitive_national',
    ]),
    /** Terms the grade should reference by name (specific figures, methods). */
    must_mention: z.array(z.string()).default([]),
    notes: z.string().default(''),
  }),

  /**
   * Real human-judge scores. NULL until a human has actually scored this artifact.
   * The correlation gate (Pearson r ≥ 0.8) only runs over cases where this is present.
   * NEVER fill this with a guess — an invented human score defeats the entire harness.
   */
  human: z
    .object({
      total: z.number(),
      max: z.number(),
      judges: z.array(z.string()).default([]),
      note: z.string().default(''),
    })
    .nullable()
    .default(null),
});
export type EvalCase = z.infer<typeof EvalCase>;

export { TranscriptJSON };
