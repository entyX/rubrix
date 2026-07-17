/**
 * The AI Judge — plan.md §9.5 (grading) + §9.7 (post-grade validation).
 *
 * "The grader is the product." Everything the model returns is treated as a claim to
 * be checked, not an answer to be displayed. In order, §9.7:
 *   1. Zod parse (strip fences first)                    -> retry once on failure
 *   2. Criterion coverage: every rubric id, exactly once -> retry once on failure
 *   3. Arithmetic: recompute the total in code and OVERWRITE the model's
 *   4. Hallucination check: every quote must be >=85% grounded in the submission, or
 *      the quote is stripped and the criterion's confidence drops one step
 *   5. Clamp every score to [0, max_points]
 *
 * One judge, two submission types (§3 `prejudged_plus_presentation` takes either or
 * both): a WEBSITE and/or a PRESENTATION recording. Whatever is missing is reported
 * as not-assessable rather than silently scored zero — see assessable_possible.
 */
import { generate, MAX_OUTPUT_TOKENS, THINKING_BUDGET, type ImagePart } from './gemini';
import {
  GRADING_SYSTEM,
  buildGradingUser,
  validationRetryMessage,
  PROMPT_VERSION_GRADING,
  fill,
} from './prompts';
import {
  GradingResultJSON,
  GRADING_RESPONSE_SCHEMA,
  type RubricJSON,
  type TranscriptJSON,
  TIERS,
} from './schemas';
import { parseModelJson } from './json';
import { isGrounded, dropConfidence } from './grounding';
import { formatTranscriptLines, estimateTokens, MAX_TRANSCRIPT_TOKENS, mmss } from '@/lib/transcript/format';
import type { DeliveryMetrics } from '@/lib/metrics/delivery';
import type { SiteCapture } from '@/lib/site/crawl';
import type { SiteMetrics } from '@/lib/site/metrics';
import { addUsage, ZERO_USAGE, type TokenUsage } from './models';

export interface EventContext {
  org: string;
  eventName: string;
  timeLimitS: number | null;
  teamSize: number;
  /** plan.md §9.5 {{SCORE_ANCHORS}} — per-event calibration prose. '' when none. */
  scoreAnchors: string;
}

/** Either half may be absent. At least one must be present. */
export interface Submission {
  presentation?: { transcript: TranscriptJSON; metrics: DeliveryMetrics };
  site?: { capture: SiteCapture; metrics: SiteMetrics };
  /**
   * The judge's questions and the student's answers, once they've done the drill.
   * Without this, question-answering criteria are NEVER scored (prompt rule 5b) —
   * you can't fail an answer to a question nobody asked you.
   */
  qa?: Array<{ question: string; answer: string }>;
  /**
   * Still frames sampled from the presentation video, in the browser (DECISIONS D-015).
   * Present only when the student opted in. These let visual delivery criteria (posture,
   * eye contact, appearance, gestures, visual aids) actually be judged instead of excluded.
   */
  frames?: Array<{ base64: string; mimeType: string; atSeconds: number }>;
}

/** What post-validation had to change. These are the numbers §10 tracks. */
export interface ValidationReport {
  hallucinated_quotes_stripped: number;
  criteria_with_confidence_dropped: string[];
  criteria_with_no_evidence_left: string[];
  arithmetic_overwritten: boolean;
  model_total: number;
  computed_total: number;
  tier_overwritten: boolean;
  scores_clamped: string[];
  coverage_retry_used: boolean;
  schema_retry_used: boolean;
  /** Why the first attempt failed Zod. A retry doubles the cost of a grade — track it. */
  schema_retry_issues?: string;
  not_assessable: string[];
  not_assessable_points: number;
}

export interface GradeResult {
  result: GradingResultJSON;
  report: ValidationReport;
  usage: TokenUsage;
  costCents: number;
  promptVersion: string;
}

/** plan.md §9.5 rule 10. Recomputed in code — the model's tier is not trusted. */
export function tierFromPct(pct: number): (typeof TIERS)[number] {
  if (pct < 55) return 'needs_work';
  if (pct <= 70) return 'competitive_regional';
  if (pct <= 85) return 'competitive_state';
  return 'competitive_national';
}

const EASE_WEIGHT: Record<'easy' | 'medium' | 'hard', number> = {
  easy: 1.0,
  medium: 0.6,
  hard: 0.3,
};

/** Everything a quote could honestly have come from. The §9.7 grounding haystack. */
export function groundingCorpus(sub: Submission): string {
  const parts: string[] = [];
  if (sub.presentation) parts.push(sub.presentation.transcript.full_text);
  if (sub.site) parts.push(sub.site.capture.corpus);
  // The student's Q&A answers are legitimate quotable evidence too — without this,
  // every quote from an answer would be stripped as a hallucination.
  if (sub.qa) parts.push(sub.qa.map((t) => t.answer).join('\n'));
  return parts.join('\n\n');
}

function emptyReport(): ValidationReport {
  return {
    hallucinated_quotes_stripped: 0,
    criteria_with_confidence_dropped: [],
    criteria_with_no_evidence_left: [],
    arithmetic_overwritten: false,
    model_total: 0,
    computed_total: 0,
    tier_overwritten: false,
    scores_clamped: [],
    coverage_retry_used: false,
    schema_retry_used: false,
    not_assessable: [],
    not_assessable_points: 0,
  };
}

export async function gradeSubmission(args: {
  rubric: RubricJSON;
  submission: Submission;
  event: EventContext;
  runId: string;
  /**
   * Decoding seed. Fixed at 7 in production for reproducibility (§9.7). The eval harness
   * passes different seeds across its 3 runs to measure genuine run-to-run spread —
   * without varying it, the runs are byte-identical and the consistency check is a lie.
   */
  seed?: number;
}): Promise<GradeResult> {
  const { rubric, submission, event, runId, seed = 7 } = args;

  if (!submission.presentation && !submission.site) {
    throw new Error('Nothing to grade: provide a website, a recording, or both.');
  }

  // ---- assemble the prompt inputs
  const images: ImagePart[] = [];
  let sitePart: Parameters<typeof buildGradingUser>[0]['site'];

  if (submission.site) {
    const { capture, metrics } = submission.site;
    for (const p of capture.pages) {
      for (const s of p.shots) {
        images.push({
          base64: s.base64,
          mimeType: 'image/jpeg',
          caption: `Screenshot — ${p.url} rendered at ${s.viewport} size${
            s.horizontalOverflow ? ' (NOTE: content overflows horizontally here)' : ''
          }:`,
        });
      }
    }
    sitePart = {
      entry: capture.entry,
      metricsJson: JSON.stringify(metrics),
      pages: capture.pages.map((p) => ({
        url: p.url,
        title: p.title,
        text: p.text.slice(0, 6_000),
        html: p.html.slice(0, 20_000),
      })),
      assets: capture.assets.map((a) => ({ url: a.url, kind: a.kind, content: a.content.slice(0, 15_000) })),
    };
  }

  let presPart: Parameters<typeof buildGradingUser>[0]['presentation'];
  if (submission.presentation) {
    const lines = formatTranscriptLines(submission.presentation.transcript);
    if (estimateTokens(lines) > MAX_TRANSCRIPT_TOKENS) {
      throw new Error('That run is too long for us to judge well. Keep practice runs under 20 minutes.');
    }
    presPart = {
      durationS: Math.round(submission.presentation.metrics.duration_s),
      timeLimitS: event.timeLimitS ?? 0,
      transcriptLines: lines,
      metricsJson: JSON.stringify(submission.presentation.metrics),
    };
  }

  // Video frames -> image parts. Captioned with their timestamp so the model can line them
  // up with the transcript ("at 1:12 they were reading from notes").
  for (const f of submission.frames ?? []) {
    images.push({
      base64: f.base64,
      mimeType: f.mimeType,
      caption: `Still frame from the presentation video at ${mmss(f.atSeconds)}:`,
    });
  }

  const system = fill(GRADING_SYSTEM, {
    ORG: event.org.toUpperCase(),
    EVENT_NAME: event.eventName,
    SCORE_ANCHORS: event.scoreAnchors,
    TIME_LIMIT: event.timeLimitS === null ? 'not specified' : `${event.timeLimitS} seconds`,
    ACTUAL_DURATION: presPart ? `${presPart.durationS} seconds` : 'no recording submitted',
  });

  const user = buildGradingUser({
    rubricJson: JSON.stringify(rubric),
    teamSize: event.teamSize,
    presentation: presPart,
    site: sitePart,
    qa: submission.qa,
    frameCount: submission.frames?.length ?? 0,
  });

  const report = emptyReport();
  let usage: TokenUsage = ZERO_USAGE;
  let cost = 0;
  let result: GradingResultJSON | null = null;
  let correction = '';

  // ---- §9.7 steps 1 & 2: schema + coverage, with ONE retry between them.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generate({
      system,
      user: correction === '' ? user : `${user}\n\n${correction}`,
      responseSchema: GRADING_RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS.grade,
      // plan.md §9.5 allows 0–0.2. The eval harness measured run-to-run spread at 0.2 at
      // ~20pts (same input, different score) and at 0 at ~4pts — a 4–5× reduction. A grader
      // must be reproducible, so we run at 0. Residual spread is closed by §9.7's 3-run
      // median (Phase 1.5). See docs/eval-results and the changelog.
      temperature: 0,
      seed,
      thinkingBudget: THINKING_BUDGET.standard,
      images,
      promptVersion: PROMPT_VERSION_GRADING,
      runId,
      label: attempt === 0 ? 'grade' : 'grade:retry',
    });
    usage = addUsage(usage, res.usage);
    cost += res.costCents;

    const parsed = parseModelJson(res.text, GradingResultJSON);
    if (!parsed.ok) {
      if (attempt === 1) throw new Error(`The judge stumbled on this one (schema): ${parsed.issues}`);
      report.schema_retry_used = true;
      report.schema_retry_issues = parsed.issues;
      // A retry doubles the cost and latency of a grade. Make it loud, not silent.
      console.warn(`[grade] run=${runId} schema retry — ${parsed.issues}`);
      correction = validationRetryMessage(parsed.issues);
      continue;
    }

    const coverage = checkCoverage(parsed.value, rubric);
    if (coverage !== null) {
      if (attempt === 1) throw new Error(`The judge stumbled on this one (coverage): ${coverage}`);
      report.coverage_retry_used = true;
      console.warn(`[grade] run=${runId} coverage retry — ${coverage}`);
      correction = validationRetryMessage(coverage);
      continue;
    }

    result = parsed.value;
    break;
  }

  if (!result) throw new Error('The judge stumbled on this one. Your grading credit was not used.');

  const validated = postValidate({ result, rubric, submission, event, report });
  return {
    result: validated.result,
    report: validated.report,
    usage,
    costCents: cost,
    promptVersion: PROMPT_VERSION_GRADING,
  };
}

/**
 * §9.7 steps 3–5, as a PURE function of (model output, rubric, submission).
 *
 * Pure on purpose: this is where a hallucinated quote gets caught, and §17 M8's
 * acceptance criterion is "a planted fake quote demonstrably stripped in a unit
 * test". That test must not need an API key or a network.
 */
export function postValidate(args: {
  result: GradingResultJSON;
  rubric: RubricJSON;
  submission: Submission;
  event: EventContext;
  report?: ValidationReport;
}): { result: GradingResultJSON; report: ValidationReport } {
  const { rubric, submission, event } = args;
  // Don't mutate the caller's object — tests and retries both depend on this.
  const result: GradingResultJSON = structuredClone(args.result);
  const report: ValidationReport = args.report ?? emptyReport();

  const corpus = groundingCorpus(submission);

  // ---- step 5: clamp every score into [0, max_points], taken from the RUBRIC.
  const maxById = new Map(rubric.criteria.map((c) => [c.id, c.max_points]));
  for (const c of result.criteria) {
    const max = maxById.get(c.criterion_id) ?? c.max_points;
    c.max_points = max; // the rubric is canonical, not the model's echo of it
    const clamped = Math.min(Math.max(c.score, 0), max);
    if (clamped !== c.score) {
      report.scores_clamped.push(c.criterion_id);
      c.score = clamped;
    }
    // A criterion nothing in the submission could evidence scores 0 and is excluded
    // from the honest denominator below.
    if (!c.assessable) {
      c.score = 0;
      report.not_assessable.push(c.criterion_id);
      report.not_assessable_points += max;
    }
  }

  // ---- step 4: hallucination check (non-negotiable).
  for (const c of result.criteria) {
    const kept: typeof c.evidence = [];
    let strippedHere = 0;

    for (const e of c.evidence) {
      // 'visual' evidence describes a video frame, not a text quote — nothing to ground it
      // against, so it skips the hallucination check (like 'document').
      if (e.source === 'visual') {
        kept.push(e);
        continue;
      }
      if (isGrounded(e.quote, corpus)) {
        kept.push({ ...e, source: e.source ?? (submission.site ? 'document' : 'transcript') });
      } else {
        strippedHere++;
        report.hallucinated_quotes_stripped++;
      }
    }

    if (strippedHere > 0) {
      const before = c.confidence;
      c.confidence = dropConfidence(c.confidence);
      if (c.confidence !== before) report.criteria_with_confidence_dropped.push(c.criterion_id);

      if (kept.length === 0 && c.assessable) {
        report.criteria_with_no_evidence_left.push(c.criterion_id);
        c.not_assessable_reason =
          c.not_assessable_reason ??
          'The judge could not point to anything actually in this submission to support this score.';
      }
    }
    c.evidence = kept;
  }

  // ---- step 3: arithmetic. Trust the sum, overwrite the model.
  const computedTotal = result.criteria.reduce((sum, c) => sum + c.score, 0);
  const totalPossible = rubric.criteria.reduce((sum, c) => sum + c.max_points, 0);

  report.model_total = result.total_score;
  report.computed_total = computedTotal;
  report.arithmetic_overwritten = Math.abs(result.total_score - computedTotal) > 1e-6;

  result.total_score = Number(computedTotal.toFixed(2));
  result.total_possible = totalPossible;

  // The honest denominator: what this submission could actually have earned.
  const assessablePossible = result.criteria
    .filter((c) => c.assessable)
    .reduce((sum, c) => sum + c.max_points, 0);
  result.assessable_score = Number(computedTotal.toFixed(2));
  result.assessable_possible = assessablePossible;

  // Tier is computed off the ASSESSABLE percentage. Grading a website-only entry
  // against a sheet that also scores live delivery would otherwise always read
  // "needs_work" — punishing the student for what they didn't submit.
  const pct = assessablePossible > 0 ? (computedTotal / assessablePossible) * 100 : 0;
  const computedTier = tierFromPct(pct);
  report.tier_overwritten = result.tier !== computedTier;
  result.tier = computedTier;

  // Timing is computed in code, never by the LLM (§9.2). Only when a run exists.
  if (event.timeLimitS !== null && submission.presentation) {
    const actual = submission.presentation.metrics.duration_s;
    const over = actual > event.timeLimitS;
    const delta = Math.abs(actual - event.timeLimitS);
    result.timing = {
      limit_s: event.timeLimitS,
      actual_s: Math.round(actual),
      over,
      // NOTE: no numeric point penalty is applied. Official per-event penalties are
      // not in plan.md and we do not invent FBLA rules (CLAUDE.md). See DECISIONS D-005.
      note: over
        ? `${Math.round(delta)}s over the ${event.timeLimitS}s limit. Real judges apply a time penalty here; this practice score does not.`
        : `${Math.round(delta)}s under the ${event.timeLimitS}s limit.`,
    };
  } else {
    delete result.timing;
  }

  // point_gaps_ranked: recomputed in code. Criteria the submission cannot evidence
  // are excluded — "submit a recording" is not a point gap you fix by improving.
  result.point_gaps_ranked = result.criteria
    .filter((c) => c.assessable)
    .map((c) => ({
      criterion_id: c.criterion_id,
      points_available: Number((c.max_points - c.score).toFixed(2)),
      difficulty: c.difficulty,
    }))
    .filter((g) => g.points_available > 0)
    .sort(
      (a, b) =>
        b.points_available * EASE_WEIGHT[b.difficulty] -
        a.points_available * EASE_WEIGHT[a.difficulty],
    );

  return { result, report };
}

/** §9.7 step 2. Returns null when coverage is correct, else a message for the retry. */
export function checkCoverage(result: GradingResultJSON, rubric: RubricJSON): string | null {
  const wanted = rubric.criteria.map((c) => c.id);
  const got = result.criteria.map((c) => c.criterion_id);

  const missing = wanted.filter((id) => !got.includes(id));
  const unknown = got.filter((id) => !wanted.includes(id));
  const dupes = got.filter((id, i) => got.indexOf(id) !== i);

  const problems: string[] = [];
  if (missing.length) problems.push(`missing criteria: ${missing.join(', ')}`);
  if (unknown.length) problems.push(`criteria not in the rubric: ${unknown.join(', ')}`);
  if (dupes.length) problems.push(`duplicated criteria: ${[...new Set(dupes)].join(', ')}`);

  return problems.length ? problems.join('; ') : null;
}
