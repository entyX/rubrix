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
  type VisualReportJSON,
  TIERS,
} from './schemas';
import { renderVisualReport } from './visual';
import { parseModelJson } from './json';
import { isGrounded, dropConfidence, findQuoteStart } from './grounding';
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
   * When `visual` is also present, the frames are NOT re-sent to the judge — the report
   * already covers them; the raw frames are the fallback path only.
   */
  frames?: Array<{ base64: string; mimeType: string; atSeconds: number }>;
  /**
   * The visual delivery report (DECISIONS D-018): the open-source vision model watched
   * frames sampled across the WHOLE run and wrote timestamped observations. The judge
   * scores visual criteria from this text, and every source-"visual" evidence quote is
   * grounded against it in postValidate — no more free pass for visual claims.
   */
  visual?: { report: VisualReportJSON; frameCount: number };
  /**
   * Pre-submission materials (D-019): the prejudged document some events require — a
   * report, plan, or portfolio — as extracted text. Criteria that can only be
   * evidenced by that document become assessable when this is present; its text joins
   * the grounding corpus so source-"document" quotes are checked like everything else.
   */
  materials?: { name: string; text: string };
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
  /**
   * D-019: how many evidence timestamps the model got wrong and code corrected (or
   * removed, when the quote isn't from the recording at all).
   */
  timestamps_realigned: number;
  /** D-020: proposed time-coaching cuts whose "verbatim" quote wasn't in the recording. */
  time_cuts_stripped: number;
  /** D-022: assessable criteria capped at half points for having zero surviving evidence. */
  no_evidence_caps: string[];
}

export interface GradeResult {
  result: GradingResultJSON;
  report: ValidationReport;
  usage: TokenUsage;
  costCents: number;
  promptVersion: string;
  /** Which model actually judged (D-023): 'gemini', or 'openrouter' on quota fallback. */
  judgeProvider: 'gemini' | 'openrouter';
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
  // The visual report is quotable evidence for visual criteria — and rendering it
  // here with the SAME function that renders it into the prompt is what makes the
  // grounding check honest: the judge quotes exactly what it was shown.
  if (sub.visual) parts.push(renderVisualReport(sub.visual.report));
  // Pre-submitted materials are quotable evidence for prejudged criteria (D-019).
  if (sub.materials) parts.push(sub.materials.text);
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
    timestamps_realigned: 0,
    time_cuts_stripped: 0,
    no_evidence_caps: [],
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

  if (!submission.presentation && !submission.site && !submission.materials) {
    throw new Error('Nothing to grade: provide a recording, a website, or pre-submission materials.');
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

  // Video frames -> image parts, but ONLY when no visual report exists (D-018): the
  // report already covers every sampled frame, so re-attaching them would just spend
  // Gemini tokens on pixels the open-source model has already read.
  if (!submission.visual) {
    for (const f of submission.frames ?? []) {
      images.push({
        base64: f.base64,
        mimeType: f.mimeType,
        caption: `Still frame from the presentation video at ${mmss(f.atSeconds)}:`,
      });
    }
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
    frameCount: submission.visual ? 0 : (submission.frames?.length ?? 0),
    visualReportText: submission.visual ? renderVisualReport(submission.visual.report) : undefined,
    visualFrameCount: submission.visual?.frameCount,
    materials: submission.materials,
  });

  const report = emptyReport();
  let usage: TokenUsage = ZERO_USAGE;
  let cost = 0;
  let result: GradingResultJSON | null = null;
  let correction = '';
  let judgeProvider: 'gemini' | 'openrouter' = 'gemini';

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
    judgeProvider = res.provider;

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
    judgeProvider,
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
      // 'visual' evidence: when a visual REPORT exists, the quote must be verbatim
      // from it — the report text is in the corpus, so it goes through the same
      // grounding check as everything else. Only the raw-frames fallback (the judge
      // describing pixels no text can vouch for) still skips the check.
      if (e.source === 'visual' && !submission.visual) {
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

  // ---- D-022: no receipts, no high marks. An assessable criterion the judge cannot
  // support with a single SURVIVING piece of evidence is capped at half its points —
  // in code, after the hallucination strip, so a score built on an invented quote
  // falls with the quote. The prompt states the same rule; this is the enforcement.
  for (const c of result.criteria) {
    if (!c.assessable || c.evidence.length > 0) continue;
    const cap = Number((c.max_points * 0.5).toFixed(2));
    if (c.score > cap) {
      c.score = cap;
      report.no_evidence_caps.push(c.criterion_id);
    }
  }

  // ---- D-019: evidence timestamps are computed in code, never trusted (§9.2's rule,
  // applied to the one number the model was still allowed to make up). Every grounded
  // transcript quote provably exists in the segments, so its true position is a fact:
  // find it and overwrite. A quote that is NOT in the recording (e.g. from a typed
  // Q&A answer) loses its timestamp — that precision would be fabricated.
  if (submission.presentation) {
    const segs = submission.presentation.transcript.segments;
    for (const c of result.criteria) {
      for (const e of c.evidence) {
        if (e.source !== undefined && e.source !== 'transcript') continue;
        const found = findQuoteStart(e.quote, segs);
        if (found !== null) {
          if (e.timestamp_start === undefined || Math.abs(e.timestamp_start - found) > 1) {
            report.timestamps_realigned++;
          }
          e.timestamp_start = found;
        } else if (e.timestamp_start !== undefined) {
          delete e.timestamp_start;
          report.timestamps_realigned++;
        }
      }
    }
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

  // ---- D-023: the presentation window. These recordings often run the timed
  // presentation followed by judge Q&A in one file, and the presentation doesn't start
  // when a host says "you may begin" — it starts when the presenter does. The model
  // marks the boundaries from the transcript; code clamps them to real segment edges
  // and derives the presentation's true length. Timing + time coaching judge THAT, not
  // the whole recording.
  let presentationDurationS = submission.presentation?.metrics.duration_s ?? 0;
  if (submission.presentation && result.presentation_window) {
    const segs = submission.presentation.transcript.segments;
    const recorded = submission.presentation.metrics.duration_s;
    const snap = (t: number, edge: 'start' | 'end') => {
      let best = t;
      let bestDist = Infinity;
      for (const s of segs) {
        const v = edge === 'start' ? s.start : s.end;
        const d = Math.abs(v - t);
        if (d < bestDist) {
          bestDist = d;
          best = v;
        }
      }
      return segs.length ? best : t;
    };
    const w = result.presentation_window;
    const start = snap(Math.max(0, Math.min(w.start_s, recorded)), 'start');
    let end = snap(Math.max(0, Math.min(w.end_s, recorded)), 'end');
    if (end <= start) end = recorded; // a nonsense window -> treat the whole run as the presentation
    result.presentation_window = {
      start_s: Number(start.toFixed(1)),
      end_s: Number(end.toFixed(1)),
      qa_present: w.qa_present,
    };
    presentationDurationS = end - start;
  } else {
    delete result.presentation_window;
  }

  // ---- D-020: time coaching — the model's judgment, code's numbers.
  if (result.time_coaching) {
    if (!submission.presentation || event.timeLimitS === null) {
      // Nothing to coach on: no recording, or the event has no limit. A time plan
      // here would be advice about evidence that doesn't exist.
      delete result.time_coaching;
    } else {
      const tc = result.time_coaching;
      const actual = presentationDurationS; // the presentation, not the whole recording (D-023)
      const limit = event.timeLimitS;
      // Verdict is arithmetic, not opinion. "under" means comfortably under — more
      // than 15% of the limit unused (a coaching heuristic, not an org rule; official
      // under-time penalties vary by event and are never invented here — D-005).
      tc.verdict = actual > limit ? 'over' : actual < limit * 0.85 ? 'under' : 'fits';

      // Every cut must be verbatim from the RECORDING — same bar as evidence quotes.
      // Time saved is computed from the quote's word count at the speaker's own
      // measured pace; the model was told not to estimate it, and isn't trusted to.
      const transcriptText = submission.presentation.transcript.full_text;
      const wpm = submission.presentation.metrics.words_per_minute;
      const kept: typeof tc.cuts = [];
      for (const cut of tc.cuts) {
        if (!isGrounded(cut.quote, transcriptText)) {
          report.time_cuts_stripped++;
          continue;
        }
        const words = cut.quote.trim() === '' ? 0 : cut.quote.trim().split(/\s+/).length;
        kept.push({
          quote: cut.quote,
          reason: cut.reason,
          ...(wpm > 0 ? { seconds_saved: Number(((words / wpm) * 60).toFixed(1)) } : {}),
        });
      }
      tc.cuts = kept;
    }
  }

  // Timing is computed in code, never by the LLM (§9.2). Only when a run exists — and
  // it measures the PRESENTATION window (D-023), so a video that includes Q&A is no
  // longer wrongly flagged "over time".
  if (event.timeLimitS !== null && submission.presentation) {
    const actual = presentationDurationS;
    const over = actual > event.timeLimitS;
    const delta = Math.abs(actual - event.timeLimitS);
    const windowed = result.presentation_window !== undefined;
    const ran = windowed
      ? `Your presentation ran ${mmss(actual)}${result.presentation_window!.qa_present ? ' (Q&A followed)' : ''} — `
      : '';
    result.timing = {
      limit_s: event.timeLimitS,
      actual_s: Math.round(actual),
      over,
      // NOTE: no numeric point penalty is applied. Official per-event penalties are
      // not in plan.md and we do not invent FBLA rules (CLAUDE.md). See DECISIONS D-005.
      note: over
        ? `${ran}${Math.round(delta)}s over the ${mmss(event.timeLimitS)} limit. Real judges apply a time penalty here; this practice score does not.`
        : `${ran}${Math.round(delta)}s under the ${mmss(event.timeLimitS)} limit.`,
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
