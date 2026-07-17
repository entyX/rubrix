/**
 * plan.md §15 / §17 M8 / CLAUDE.md quality gates:
 *   "grading post-validation (coverage repair, arithmetic overwrite, hallucination
 *    stripping with a planted fake quote, clamping)"
 *
 * No API key, no network. These are the guardrails that stand between a student and
 * a made-up score, so they get tested against a hostile model output.
 */
import { describe, it, expect } from 'vitest';
import {
  postValidate,
  checkCoverage,
  tierFromPct,
  type EventContext,
  type Submission,
} from '@/lib/ai/grade';
import type { GradingResultJSON, RubricJSON, TranscriptJSON } from '@/lib/ai/schemas';
import type { DeliveryMetrics } from '@/lib/metrics/delivery';

const RUBRIC: RubricJSON = {
  title: 'Test rubric',
  total_points: 30,
  criteria: [
    { id: 'opening', name: 'Opening', description: 'Hook', max_points: 10 },
    { id: 'evidence', name: 'Evidence', description: 'Support', max_points: 20 },
  ],
};

const TRANSCRIPT: TranscriptJSON = {
  full_text:
    'Good morning judges. Our revenue tripled in the third quarter, from four hundred thousand to one point two million dollars. Thank you.',
  segments: [
    { start: 0, end: 3, text: 'Good morning judges.' },
    {
      start: 3,
      end: 12,
      text: 'Our revenue tripled in the third quarter, from four hundred thousand to one point two million dollars.',
    },
    { start: 12, end: 14, text: 'Thank you.' },
  ],
};

const METRICS: DeliveryMetrics = {
  duration_s: 14,
  word_count: 22,
  words_per_minute: 94,
  filler_count: 0,
  fillers_per_minute: 0,
  longest_pause_s: 0,
  time_limit_s: null,
  over_time: null,
  speaker_balance: null,
  speaker_balance_note: '',
  delivery_style: 'unclear',
  delivery_style_note: '',
};

const EVENT: EventContext = {
  org: 'fbla',
  eventName: 'Public Speaking',
  timeLimitS: null,
  teamSize: 1,
  scoreAnchors: '',
};

const SUBMISSION: Submission = {
  presentation: { transcript: TRANSCRIPT, metrics: METRICS },
};

/** A deliberately hostile model output: fake quote, bad arithmetic, out-of-range score, wrong tier. */
function hostileResult(): GradingResultJSON {
  return {
    total_score: 999, // lie
    total_possible: 12345, // lie
    tier: 'competitive_national', // lie
    summary: 'Strong run.',
    top_priorities: ['a', 'b', 'c'],
    criteria: [
      {
        criterion_id: 'opening',
        score: 47, // out of range (max 10)
        max_points: 10,
        assessable: true,
        confidence: 'high',
        justification: 'Great hook.',
        evidence: [{ quote: 'Good morning judges.', timestamp_start: 0 }], // REAL
        improvements: ['Tighten it', 'Add a stat'],
        difficulty: 'easy',
      },
      {
        criterion_id: 'evidence',
        score: 5,
        max_points: 20,
        assessable: true,
        confidence: 'high',
        justification: 'Cited figures.',
        evidence: [
          // PLANTED FAKE QUOTE — never appears in the transcript.
          {
            quote: 'We surveyed two thousand customers across eleven states and found a ninety percent approval rating.',
            timestamp_start: 5,
          },
        ],
        improvements: ['Name the source', 'Give the sample size'],
        difficulty: 'medium',
      },
    ],
    point_gaps_ranked: [],
  };
}

const run = (r: GradingResultJSON) =>
  postValidate({ result: r, rubric: RUBRIC, submission: SUBMISSION, event: EVENT });

describe('§9.7 hallucination stripping', () => {
  it('strips a planted fake quote and keeps the real one', () => {
    const { result, report } = run(hostileResult());

    expect(report.hallucinated_quotes_stripped).toBe(1);

    const evidence = result.criteria.find((c) => c.criterion_id === 'evidence')!;
    expect(evidence.evidence).toHaveLength(0); // fabricated quote is gone

    const opening = result.criteria.find((c) => c.criterion_id === 'opening')!;
    expect(opening.evidence).toHaveLength(1); // the genuine quote survives
    expect(opening.evidence[0].source).toBe('transcript');
  });

  it('drops confidence one step on the criterion that hallucinated', () => {
    const { result, report } = run(hostileResult());

    const evidence = result.criteria.find((c) => c.criterion_id === 'evidence')!;
    expect(evidence.confidence).toBe('medium'); // was 'high'
    expect(report.criteria_with_confidence_dropped).toContain('evidence');

    // The honest criterion is untouched.
    const opening = result.criteria.find((c) => c.criterion_id === 'opening')!;
    expect(opening.confidence).toBe('high');
  });

  it('flags a criterion left with no evidence at all', () => {
    const { result, report } = run(hostileResult());
    expect(report.criteria_with_no_evidence_left).toContain('evidence');
    const evidence = result.criteria.find((c) => c.criterion_id === 'evidence')!;
    expect(evidence.not_assessable_reason).toBeTruthy();
  });

  it('tolerates paraphrase-level drift but not invention', () => {
    const r = hostileResult();
    // Same words, different punctuation/case — should still count as grounded.
    r.criteria[0].evidence = [{ quote: 'good morning, judges', timestamp_start: 0 }];
    const { report } = run(r);
    // Only the fabricated 'evidence' quote is stripped; the near-match survives.
    expect(report.hallucinated_quotes_stripped).toBe(1);
  });
});

describe('§9.7 clamping', () => {
  it('clamps a score above max_points', () => {
    const { result, report } = run(hostileResult());
    const opening = result.criteria.find((c) => c.criterion_id === 'opening')!;
    expect(opening.score).toBe(10); // was 47
    expect(report.scores_clamped).toContain('opening');
  });

  it('clamps a negative score to zero', () => {
    const r = hostileResult();
    r.criteria[1].score = -5;
    const { result } = run(r);
    expect(result.criteria.find((c) => c.criterion_id === 'evidence')!.score).toBe(0);
  });
});

describe('§9.7 arithmetic overwrite', () => {
  it('recomputes the total from the criteria and overwrites the model', () => {
    const { result, report } = run(hostileResult());
    // opening clamped 47 -> 10, evidence 5. Sum = 15.
    expect(result.total_score).toBe(15);
    expect(result.total_possible).toBe(30); // from the rubric, not the model's 12345
    expect(report.arithmetic_overwritten).toBe(true);
    expect(report.model_total).toBe(999);
    expect(report.computed_total).toBe(15);
  });

  it('recomputes the tier from the real percentage', () => {
    const { result, report } = run(hostileResult());
    expect(result.tier).toBe('needs_work'); // 15/30 = 50% -> <55
    expect(report.tier_overwritten).toBe(true); // model claimed competitive_national
  });

  it('recomputes point_gaps_ranked and ranks by points x ease', () => {
    const { result } = run(hostileResult());
    // evidence: 15 available (medium, w=0.6) -> 9.0
    // opening:   0 available -> filtered out entirely
    expect(result.point_gaps_ranked[0].criterion_id).toBe('evidence');
    expect(result.point_gaps_ranked[0].points_available).toBe(15);
    expect(result.point_gaps_ranked.some((g) => g.criterion_id === 'opening')).toBe(false);
  });
});

describe('§9.7 coverage check', () => {
  it('passes when every rubric criterion appears exactly once', () => {
    expect(checkCoverage(hostileResult(), RUBRIC)).toBeNull();
  });

  it('catches a missing criterion', () => {
    const r = hostileResult();
    r.criteria = [r.criteria[0]];
    expect(checkCoverage(r, RUBRIC)).toContain('missing criteria: evidence');
  });

  it('catches a criterion the rubric never had', () => {
    const r = hostileResult();
    r.criteria[1].criterion_id = 'charisma';
    expect(checkCoverage(r, RUBRIC)).toContain('not in the rubric: charisma');
  });

  it('catches a duplicated criterion', () => {
    const r = hostileResult();
    r.criteria.push({ ...r.criteria[0] });
    expect(checkCoverage(r, RUBRIC)).toContain('duplicated criteria: opening');
  });
});

describe('§9.5 rule 10 — tier boundaries', () => {
  it.each([
    [0, 'needs_work'],
    [54.9, 'needs_work'],
    [55, 'competitive_regional'],
    [70, 'competitive_regional'],
    [70.1, 'competitive_state'],
    [85, 'competitive_state'],
    [85.1, 'competitive_national'],
    [100, 'competitive_national'],
  ])('%s%% -> %s', (pct, expected) => {
    expect(tierFromPct(pct as number)).toBe(expected);
  });
});

describe('visual evidence (video frames)', () => {
  it('keeps source:"visual" evidence without grounding it against the transcript', () => {
    const r = hostileResult();
    // A frame observation that appears nowhere in the transcript. Under the transcript
    // check it would be stripped as a hallucination; tagged "visual", it must survive.
    r.criteria[0].evidence = [
      { quote: 'The presenter stood upright and looked at the camera.', source: 'visual' },
    ];
    const { result, report } = run(r);
    const opening = result.criteria.find((c) => c.criterion_id === 'opening')!;
    expect(opening.evidence).toHaveLength(1);
    expect(opening.evidence[0].source).toBe('visual');
    // The genuinely fabricated transcript quote on the other criterion is still stripped.
    expect(report.hallucinated_quotes_stripped).toBe(1);
  });
});

describe('not-assessable criteria (prejudged submissions)', () => {
  /**
   * The real case: an FBLA website entry judged against a sheet that ALSO scores live
   * delivery. With no recording, "eye contact" cannot be judged. It must not be scored
   * as a failure — the student didn't do it badly, they didn't submit it.
   */
  it('excludes unassessable criteria from the denominator instead of failing them', () => {
    const r = hostileResult();
    r.criteria[0].score = 8; // opening: 8/10, assessable
    r.criteria[1].assessable = false; // evidence (20 pts): cannot be judged
    r.criteria[1].score = 17; // model tried to score it anyway
    r.criteria[1].not_assessable_reason = 'No recording was submitted.';

    const { result, report } = run(r);

    expect(result.criteria[1].score).toBe(0); // forced to zero...
    expect(report.not_assessable).toContain('evidence');
    expect(report.not_assessable_points).toBe(20);

    // ...but the denominator drops too, so the student isn't punished for it.
    expect(result.assessable_possible).toBe(10); // 30 total - 20 unassessable
    expect(result.assessable_score).toBe(8);
    expect(result.total_possible).toBe(30); // the full sheet is still reported

    // 8/10 = 80% -> state, NOT 8/30 = 27% -> needs_work
    expect(result.tier).toBe('competitive_state');
  });

  it('does not offer "fastest points" on something you cannot fix by improving', () => {
    const r = hostileResult();
    r.criteria[1].assessable = false;
    const { result } = run(r);
    expect(result.point_gaps_ranked.some((g) => g.criterion_id === 'evidence')).toBe(false);
  });

  it('drops the timing block entirely when no recording was submitted', () => {
    const siteOnly: Submission = { presentation: undefined };
    const { result } = postValidate({
      result: hostileResult(),
      rubric: RUBRIC,
      submission: { ...siteOnly, presentation: undefined },
      event: { ...EVENT, timeLimitS: 420 },
    });
    expect(result.timing).toBeUndefined();
  });
});

describe('purity', () => {
  it('does not mutate the model output it was handed', () => {
    const original = hostileResult();
    run(original);
    expect(original.total_score).toBe(999); // untouched
    expect(original.criteria[0].score).toBe(47);
  });
});
