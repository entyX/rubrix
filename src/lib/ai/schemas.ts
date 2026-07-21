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

/**
 * Time coaching (D-020): the judge decides WHAT to cut or add; code decides the
 * NUMBERS. `verdict` is recomputed from the measured duration, every cut's `quote`
 * must be verbatim from the transcript (grounded like evidence, stripped if not),
 * and `seconds_saved` is computed from the quote's word count at the speaker's own
 * measured pace — the model never estimates time.
 */
export const TimeCoachingJSON = z.object({
  verdict: z.enum(['over', 'fits', 'under']),
  note: z.string(),
  cuts: z
    .array(
      z.object({
        quote: z.string(),
        reason: z.string(),
        /** Filled by postValidate from word count ÷ measured WPM. Never the model's. */
        seconds_saved: z.number().optional(),
      }),
    )
    .max(5)
    .default([]),
  additions: z
    .array(
      z.object({
        suggestion: z.string(),
        targets_criterion_id: z.string().optional(),
      }),
    )
    .max(4)
    .default([]),
});
export type TimeCoachingJSON = z.infer<typeof TimeCoachingJSON>;

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
      /**
       * D-020: the strongest genuine moment for THIS criterion, or a plain statement
       * that nothing stood out. Never invented praise — the prompt says so and the
       * calibration rules still apply.
       */
      what_worked: z.string(),
      evidence: z.array(
        z.object({
          quote: z.string(),
          timestamp_start: z.number().optional(),
          // 'transcript' quotes are checked against the transcript (§9.7 hallucination
          // strip). 'document' (site/report) and 'visual' (an observation of a video
          // frame) are not text quotes, so they skip that check.
          source: z.enum(['transcript', 'document', 'visual']).optional(),
        }),
      ),
      improvements: z.array(z.string()).min(3).max(5),
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
  /** D-020: 3-6 ordered steps for the NEXT practice run, most valuable first. */
  next_run_plan: z.array(z.string()).min(3).max(6),
  /**
   * D-023: these recordings often run timed-presentation + judge Q&A in one file, and
   * the presentation doesn't start when a host says "you may begin". The model marks
   * where the presenter actually starts and where Q&A begins (from the transcript);
   * postValidate clamps them to real segments and times the PRESENTATION, not the whole
   * recording. Optional; only meaningful for presentation submissions.
   */
  presentation_window: z
    .object({
      start_s: z.number().nonnegative(),
      end_s: z.number().nonnegative(),
      qa_present: z.boolean(),
    })
    .optional(),
  /** D-020: present only when a recording AND a time limit exist (postValidate enforces). */
  time_coaching: TimeCoachingJSON.optional(),
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
// Whisper via Groq when a GROQ_API_KEY is present, else Gemini — see DECISIONS.md
// D-002 and D-018.

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

/**
 * What the MODEL returns when Gemini transcribes: segments only. full_text is derived
 * in code (segments joined with single spaces — the same rule the old prompt stated).
 * Emitting every word twice doubled the output tokens, and long runs truncated
 * mid-JSON at the output cap — the main source of "the judge returned unusable JSON"
 * failures on video uploads. Empty segments = silence, handled as a real case rather
 * than a schema error.
 */
export const TranscriptModelJSON = z.object({
  segments: z.array(
    z.object({
      start: z.number().nonnegative(),
      end: z.number().nonnegative(),
      text: z.string(),
    }),
  ),
});
export type TranscriptModelJSON = z.infer<typeof TranscriptModelJSON>;

// ------------------------------------------------ visual delivery report (D-018)
// Produced by the open-source vision model (Qwen3-VL) from frames sampled across the
// WHOLE run, then handed to the judge as text. Rendered via renderVisualReport() so
// the judge's "visual" evidence quotes can be GROUNDED against it (§9.7) instead of
// getting the free pass raw-frame observations used to get.

export const VisualReportJSON = z.object({
  /** How usable the footage was — "clear", "dim, speaker half out of frame", etc. */
  video_quality: z.string(),
  /** Timestamped, strictly observable moments. At least one per report. */
  observations: z
    .array(
      z.object({
        at_s: z.number().nonnegative(),
        note: z.string(),
      }),
    )
    .min(1),
  /** What the frames show ACROSS the run, one field per visual-delivery dimension. */
  patterns: z.object({
    posture: z.string(),
    gestures: z.string(),
    eye_line: z.string(),
    attire: z.string(),
    setting_and_aids: z.string(),
    movement: z.string(),
  }),
  /** Honesty list: what still frames cannot establish (e.g. sustained eye contact). */
  cannot_see: z.array(z.string()),
});
export type VisualReportJSON = z.infer<typeof VisualReportJSON>;

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

// NOTE: no full_text here — it is derived in code from the segments. See
// TranscriptModelJSON for why (duplicated text truncated long runs mid-JSON).
export const TRANSCRIPT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      description:
        'Ordered, non-overlapping segments covering the whole recording. Empty ONLY if the audio contains no intelligible speech.',
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
  required: ['segments'],
} as const;

/** JSON Schema for the visual report — sent to OpenRouter as response_format. */
export const VISUAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    video_quality: {
      type: 'string',
      description: 'How usable the footage is: lighting, framing, blur, distance.',
    },
    observations: {
      type: 'array',
      description:
        'Timestamped observations of what is VISIBLE in specific frames. Only what can be seen — never a guess, never a score.',
      items: {
        type: 'object',
        properties: {
          at_s: { type: 'number', description: 'Timestamp of the frame, in seconds.' },
          note: { type: 'string', description: 'What is visibly happening in this frame.' },
        },
        required: ['at_s', 'note'],
        additionalProperties: false,
      },
    },
    patterns: {
      type: 'object',
      description: 'What the frames show across the whole run, dimension by dimension.',
      properties: {
        posture: { type: 'string' },
        gestures: { type: 'string' },
        eye_line: {
          type: 'string',
          description: 'Where the speaker tends to be looking, as far as stills can show.',
        },
        attire: { type: 'string' },
        setting_and_aids: {
          type: 'string',
          description: 'The visible environment and any slides, props, or visual aids in use.',
        },
        movement: { type: 'string', description: 'How position/energy changes across the run.' },
      },
      required: ['posture', 'gestures', 'eye_line', 'attire', 'setting_and_aids', 'movement'],
      additionalProperties: false,
    },
    cannot_see: {
      type: 'array',
      description:
        'Things these still frames cannot establish (e.g. sustained eye contact, gesture fluidity). Be honest.',
      items: { type: 'string' },
    },
  },
  required: ['video_quality', 'observations', 'patterns', 'cannot_see'],
  additionalProperties: false,
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
          what_worked: {
            type: 'string',
            description:
              'The strongest genuine moment for THIS criterion (1-2 sentences, quote when possible). If nothing stood out, say so plainly. "Not assessable." for unassessable criteria. Never invented praise.',
          },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: {
                  type: 'string',
                  description:
                    'For source "transcript"/"document": VERBATIM words from the submission, never paraphrased. For source "visual": a short description of what a video frame shows.',
                },
                timestamp_start: {
                  type: 'number',
                  description: 'Transcript segment start time in seconds (spoken evidence only).',
                },
                source: {
                  type: 'string',
                  enum: ['transcript', 'document', 'visual'],
                  description:
                    'Where this evidence came from. Use "visual" for anything you observed in the attached video frames.',
                },
              },
              required: ['quote'],
            },
          },
          improvements: {
            type: 'array',
            // Enforced server-side, not just described. Without minItems the model
            // returns too few often enough to trigger the §9.7 retry, which doubles
            // the cost and latency of the grade.
            description: 'At least 3 and at most 5 concrete actions. Never fewer than 3.',
            minItems: 3,
            maxItems: 5,
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
          'what_worked',
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
    next_run_plan: {
      type: 'array',
      description:
        '3 to 6 ordered steps for the NEXT practice run, most valuable first. One imperative sentence each, specific to THIS run.',
      minItems: 3,
      maxItems: 6,
      items: { type: 'string' },
    },
    presentation_window: {
      type: 'object',
      description:
        'ONLY for a presentation recording. When the presenter ACTUALLY starts and when judge Q&A begins.',
      properties: {
        start_s: {
          type: 'number',
          description:
            'Seconds into the recording where the presenter begins presenting — NOT a host saying "you may begin", NOT dead air. Their first real presenting words.',
        },
        end_s: {
          type: 'number',
          description:
            'Seconds where the prepared presentation ends and judge Q&A begins; or the end of the recording if there is no Q&A.',
        },
        qa_present: {
          type: 'boolean',
          description: 'True if the recording contains a judge Q&A after the presentation.',
        },
      },
      required: ['start_s', 'end_s', 'qa_present'],
    },
    time_coaching: {
      type: 'object',
      description:
        'ONLY when a recording AND a time limit exist. The time plan: what to cut if over, what to add if under.',
      properties: {
        verdict: { type: 'string', enum: ['over', 'fits', 'under'] },
        note: {
          type: 'string',
          description: "1-2 coach-voice sentences on how the run used its time.",
        },
        cuts: {
          type: 'array',
          description:
            'When over the limit: 2-5 passages earning the LEAST rubric credit. quote must be VERBATIM from the transcript — it is checked word for word. Do NOT estimate time saved; code computes it.',
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              quote: { type: 'string', description: 'VERBATIM words from the transcript.' },
              reason: {
                type: 'string',
                description: 'Why the rubric loses little by cutting this passage.',
              },
            },
            required: ['quote', 'reason'],
          },
        },
        additions: {
          type: 'array',
          description:
            'When well under the limit: 1-4 things to add or expand, each tied to a weak criterion.',
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              suggestion: { type: 'string' },
              targets_criterion_id: {
                type: 'string',
                description: 'The rubric criterion this addition would strengthen.',
              },
            },
            required: ['suggestion'],
          },
        },
      },
      required: ['verdict', 'note', 'cuts', 'additions'],
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
    'next_run_plan',
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
