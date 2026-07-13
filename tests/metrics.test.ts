/**
 * plan.md §9.2 deterministic metrics + transcript formatter + rubric schema.
 * These numbers are injected into the grading prompt as "computed, trustworthy",
 * so they had better be.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDeliveryMetrics,
  countFillers,
  countWords,
  longestPause,
} from '@/lib/metrics/delivery';
import { mmss, formatTranscriptLines } from '@/lib/transcript/format';
import { RubricJSON, GradingResultJSON } from '@/lib/ai/schemas';
import { stripFences, parseModelJson } from '@/lib/ai/json';
import { bestMatchScore, isGrounded, normalize } from '@/lib/ai/grounding';
import type { TranscriptJSON } from '@/lib/ai/schemas';

const T: TranscriptJSON = {
  full_text: 'Um, so our plan is, like, really strong. You know, uh, we tripled revenue.',
  segments: [
    { start: 0, end: 4, text: 'Um, so our plan is, like, really strong.' },
    { start: 10, end: 14, text: 'You know, uh, we tripled revenue.' },
  ],
};

describe('§9.2 filler counting', () => {
  it('counts um, uh, like, you know, and sentence-initial so', () => {
    const { total, byType } = countFillers(T.full_text);
    expect(byType['um']).toBe(1);
    expect(byType['uh']).toBe(1);
    expect(byType['like']).toBe(1);
    expect(byType['you know']).toBe(1);
    expect(total).toBe(5); // + the sentence-initial "so"
  });

  it('does not count "so" mid-sentence', () => {
    // "so" here is ordinary English, not a filler.
    expect(countFillers('The market was small so we pivoted.').byType['so (sentence-initial)']).toBe(0);
  });

  it('counts stretched fillers (ummm, uhh)', () => {
    expect(countFillers('Ummm, uhh, right.').total).toBe(2);
  });
});

describe('§9.2 pacing', () => {
  it('counts words', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('   ')).toBe(0);
  });

  it('finds the longest silent gap between segments', () => {
    expect(longestPause(T)).toBe(6); // 10 - 4
  });

  it('computes wpm against the REAL duration, not the segment spans', () => {
    const m = computeDeliveryMetrics(T, 30, 300);
    expect(m.word_count).toBe(14);
    expect(m.words_per_minute).toBe(28); // 14 words / 0.5 min
    expect(m.duration_s).toBe(30);
  });

  it('flags over-time in code, never by the LLM', () => {
    expect(computeDeliveryMetrics(T, 400, 300).over_time).toBe(true);
    expect(computeDeliveryMetrics(T, 200, 300).over_time).toBe(false);
    expect(computeDeliveryMetrics(T, 200, null).over_time).toBeNull();
  });

  it('reports speaker balance as unmeasured rather than guessing', () => {
    const m = computeDeliveryMetrics(T, 30, null);
    expect(m.speaker_balance).toBeNull();
    expect(m.speaker_balance_note).toMatch(/diariz/i);
  });
});

describe('transcript formatter', () => {
  it('formats mm:ss', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(9)).toBe('0:09');
    expect(mmss(75)).toBe('1:15');
    expect(mmss(3675)).toBe('1:01:15');
  });

  it('emits one [mm:ss] line per segment', () => {
    expect(formatTranscriptLines(T)).toBe(
      '[0:00] Um, so our plan is, like, really strong.\n[0:10] You know, uh, we tripled revenue.',
    );
  });
});

describe('§9.7 step 1 — fence stripping', () => {
  it('strips ```json fences', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });

  it('reports Zod issues instead of throwing', () => {
    const out = parseModelJson('{"total_score": "not a number"}', GradingResultJSON);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues.length).toBeGreaterThan(0);
  });

  it('reports invalid JSON instead of throwing', () => {
    const out = parseModelJson('not json at all', GradingResultJSON);
    expect(out.ok).toBe(false);
  });
});

describe('grounding', () => {
  const hay = 'Our revenue tripled in the third quarter to one point two million dollars.';

  it('normalizes case, punctuation and curly apostrophes', () => {
    expect(normalize("Don’t — STOP!")).toBe('dont stop');
  });

  it('scores an exact quote 1', () => {
    expect(bestMatchScore('revenue tripled in the third quarter', hay)).toBe(1);
  });

  it('accepts a near-verbatim quote above the 85% bar', () => {
    expect(isGrounded('Our revenue tripled in the third quarter', hay)).toBe(true);
  });

  it('rejects an invented quote', () => {
    expect(isGrounded('We surveyed two thousand customers in eleven states', hay)).toBe(false);
  });

  it('rejects an empty quote', () => {
    expect(isGrounded('', hay)).toBe(false);
  });
});

describe('§9.3 RubricJSON schema', () => {
  it('accepts a valid rubric', () => {
    expect(
      RubricJSON.safeParse({
        title: 'T',
        total_points: 10,
        criteria: [{ id: 'a_b', name: 'A', description: 'd', max_points: 10 }],
      }).success,
    ).toBe(true);
  });

  it('rejects a non-snake_case id', () => {
    expect(
      RubricJSON.safeParse({
        title: 'T',
        total_points: 10,
        criteria: [{ id: 'Not Snake', name: 'A', description: 'd', max_points: 10 }],
      }).success,
    ).toBe(false);
  });

  it('rejects zero or negative max_points', () => {
    expect(
      RubricJSON.safeParse({
        title: 'T',
        total_points: 10,
        criteria: [{ id: 'a', name: 'A', description: 'd', max_points: 0 }],
      }).success,
    ).toBe(false);
  });

  it('rejects an empty rubric', () => {
    expect(RubricJSON.safeParse({ title: 'T', total_points: 10, criteria: [] }).success).toBe(false);
  });
});
