/**
 * Zod schemas — plan.md §9.3, verbatim.
 * Every LLM JSON output is validated against these (CLAUDE.md: "Zod-validate every boundary").
 *
 * Two representations per payload:
 *   - the Zod schema  -> the real gate. Enforces counts (.min/.max/.length) and ranges.
 *   - a Gemini responseSchema (plain JSON Schema) -> steers the model server-side.
 *
 * They are deliberately NOT the same. Gemini's responseSchema reliably enforces
 * structure/types/enums/required, but array count constraints are not dependable,
 * so counts live in Zod and a violation is repaired by the §9.7 retry loop.
 */
import { z } from 'zod';

// ---------------------------------------------------------------- rubric (F1)

export const RubricJSON = z.object({
  title: z.string(),
  total_points: z.number().positive(),
  criteria: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_]+$/),
        name: z.string(),
        description: z.string(),
        max_points: z.number().positive(),
        levels: z
          .array(
            z.object({
              label: z.string(),
              points: z.number(),
              descriptor: z.string(),
            }),
          )
          .optional(),
      }),
    )
    .min(1)
    .max(40),
});
export type RubricJSON = z.infer<typeof RubricJSON>;

// ------------------------------------------------------------- grading (§9.3)

export const TIERS = [
  'needs_work',
  'competitive_regional',
  'competitive_state',
  'competitive_national',
] as const;

export const GradingResultJSON = z.object({
  total_score: z.number(),
  total_possible: z.number(),
  /**
   * Set by post-validation, not the model. The honest denominator: the total a
   * submission could actually have earned, excluding criteria the submission
   * contains no evidence for (e.g. eye contact, when all we have is a website).
   * A website-only entry judged against a sheet that also scores live delivery
   * must not be reported as if it failed the delivery half.
   */
  assessable_score: z.number().optional(),
  assessable_possible: z.number().optional(),
  tier: z.enum(TIERS),
  summary: z.string(),
  top_priorities: z.array(z.string()).length(3),
  criteria: z.array(
    z.object({
      criterion_id: z.string(),
      score: z.number(),
      max_points: z.number(),
      /**
       * False when the SUBMISSION TYPE cannot evidence this criterion at all
       * (no recording -> cannot judge eye contact). Not the same as "did badly".
       */
      assessable: z.boolean(),
      confidence: z.enum(['high', 'medium', 'low']),
      not_assessable_reason: z.string().optional(),
      justification: z.string(),
      evidence: z.array(
        z.object({
          quote: z.string(),
          timestamp_start: z.number().optional(),
          // Set by post-validation, not the model: document quotes skip the
          // transcript hallucination check (plan.md §9.7).
          source: z.enum(['transcript', 'document']).optional(),
        }),
      ),
      improvements: z.array(z.string()).min(2).max(4),
      difficulty: z.enum(['easy', 'medium', 'hard']),
    }),
  ),
  point_gaps_ranked: z.array(
    z.object({
      criterion_id: z.string(),
      points_available: z.number(),
      difficulty: z.enum(['easy', 'medium', 'hard']),
    }),
  ),
  timing: z
    .object({
      limit_s: z.number(),
      actual_s: z.number(),
      over: z.boolean(),
      note: z.string(),
    })
    .optional(),
});
export type GradingResultJSON = z.infer<typeof GradingResultJSON>;

export const QAJSON = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        targets: z.string(),
        difficulty: z.enum(['warmup', 'standard', 'hard']),
        answer_points: z.array(z.string()).min(2).max(4),
      }),
    )
    .min(8)
    .max(12),
});
export type QAJSON = z.infer<typeof QAJSON>;

export const PracticeTurnJSON = z.object({
  score: z.number().int().min(1).max(5),
  feedback: z.string(),
  follow_up: z.string().optional(),
});
export type PracticeTurnJSON = z.infer<typeof PracticeTurnJSON>;

// ------------------------------------------------------ transcript (amendment)
// plan.md §9.1 shape {full_text, segments:[{start,end,text}]}. The producer is
// Gemini rather than Whisper — see DECISIONS.md D-002.

export const TranscriptJSON = z.object({
  full_text: z.string(),
  segments: z
    .array(
      z.object({
        start: z.number().nonnegative(),
        end: z.number().nonnegative(),
        text: z.string(),
      }),
    )
    .min(1),
});
export type TranscriptJSON = z.infer<typeof TranscriptJSON>;

// -------------------------------------------- Gemini responseSchema (JSON Schema)
// Verified enforcing on gemini-2.5-flash via models.generateContent +
// responseMimeType 'application/json' + responseSchema. (The newer
// interactions API silently IGNORES response_format — see DECISIONS.md D-003.)

export const RUBRIC_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    total_points: { type: 'number' },
    criteria: {
      // NOTE: no minItems/maxItems here. Bounding this array while it contains a nested
      // array (`levels`) makes Gemini 400 with "schema produces a constraint that has too
      // many states for serving". Zod enforces .min(1).max(40) after the fact instead.
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'short snake_case slug derived from the name, [a-z0-9_] only',
          },
          name: { type: 'string' },
          description: { type: 'string' },
          max_points: { type: 'number', description: 'the HIGHEST point value for this line item' },
          levels: {
            type: 'array',
            description: 'the performance levels, if the sheet uses them',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                points: { type: 'number' },
                descriptor: { type: 'string' },
              },
              required: ['label', 'points', 'descriptor'],
            },
          },
        },
        required: ['id', 'name', 'description', 'max_points'],
      },
    },
  },
  required: ['title', 'total_points', 'criteria'],
} as const;

export const TRANSCRIPT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    full_text: { type: 'string', description: 'The complete verbatim transcript.' },
    segments: {
      type: 'array',
      description: 'Ordered, non-overlapping segments covering the whole recording.',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number', description: 'Segment start, in SECONDS from 0.' },
          end: { type: 'number', description: 'Segment end, in SECONDS from 0.' },
          text: { type: 'string', description: 'Verbatim words spoken in this segment.' },
        },
        required: ['start', 'end', 'text'],
      },
    },
  },
  required: ['full_text', 'segments'],
} as const;

export const GRADING_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    total_score: { type: 'number' },
    total_possible: { type: 'number' },
    tier: { type: 'string', enum: [...TIERS] },
    summary: { type: 'string' },
    top_priorities: {
      type: 'array',
      description: 'Exactly 3 items.',
      minItems: 3,
      maxItems: 3,
      items: { type: 'string' },
    },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion_id: { type: 'string' },
          score: { type: 'number' },
          max_points: { type: 'number' },
          assessable: {
            type: 'boolean',
            description:
              'False ONLY when this submission type cannot evidence this criterion at all (e.g. body language with no video). Not for work that is simply poor.',
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          not_assessable_reason: { type: 'string' },
          justification: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: {
                  type: 'string',
                  description: 'VERBATIM words from the submission. Never paraphrase.',
                },
                timestamp_start: {
                  type: 'number',
                  description: 'Transcript segment start time in seconds.',
                },
              },
              required: ['quote'],
            },
          },
          improvements: {
            type: 'array',
            // Enforced server-side, not just described. Without minItems the model
            // returns a single improvement often enough to trigger the §9.7 retry,
            // which doubles the cost and latency of the grade.
            description: 'At least 2 and at most 4 concrete actions. Never fewer than 2.',
            minItems: 2,
            maxItems: 4,
            items: { type: 'string' },
          },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
        },
        required: [
          'criterion_id',
          'score',
          'max_points',
          'assessable',
          'confidence',
          'justification',
          'evidence',
          'improvements',
          'difficulty',
        ],
      },
    },
    point_gaps_ranked: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion_id: { type: 'string' },
          points_available: { type: 'number' },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
        },
        required: ['criterion_id', 'points_available', 'difficulty'],
      },
    },
  },
  required: [
    'total_score',
    'total_possible',
    'tier',
    'summary',
    'top_priorities',
    'criteria',
    'point_gaps_ranked',
  ],
} as const;

export const QA_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: '8 to 12 questions.',
      minItems: 8,
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          targets: { type: 'string', description: 'What in the submission triggered this question.' },
          difficulty: { type: 'string', enum: ['warmup', 'standard', 'hard'] },
          answer_points: {
            type: 'array',
            description: 'At least 2 and at most 4 things a winning answer would hit.',
            minItems: 2,
            maxItems: 4,
            items: { type: 'string' },
          },
        },
        required: ['question', 'targets', 'difficulty', 'answer_points'],
      },
    },
  },
  required: ['questions'],
} as const;
