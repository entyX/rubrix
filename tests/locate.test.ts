/**
 * D-019 — findQuoteStart: the true position of a grounded quote is a fact computed
 * from the segments, never the model's guess. §9.2's rule applied to timestamps.
 */
import { describe, it, expect } from 'vitest';
import { findQuoteStart } from '@/lib/ai/grounding';

const SEGMENTS = [
  { start: 0, end: 3, text: 'Good morning judges.' },
  {
    start: 3,
    end: 12,
    text: 'Our revenue tripled in the third quarter, from four hundred thousand to one point two million dollars.',
  },
  { start: 12, end: 14, text: 'Thank you.' },
];

describe('findQuoteStart', () => {
  it('finds an exact quote in its segment', () => {
    expect(findQuoteStart('Thank you.', SEGMENTS)).toBe(12);
    expect(findQuoteStart('Good morning judges.', SEGMENTS)).toBe(0);
  });

  it('finds a mid-segment quote', () => {
    expect(findQuoteStart('from four hundred thousand', SEGMENTS)).toBe(3);
  });

  it('ignores punctuation and case differences', () => {
    expect(findQuoteStart('good morning, JUDGES', SEGMENTS)).toBe(0);
  });

  it('finds a quote that spans a segment boundary, returning where it BEGINS', () => {
    expect(findQuoteStart('judges. Our revenue tripled', SEGMENTS)).toBe(0);
  });

  it('tolerates small transcription drift (fuzzy, same 85% bar as grounding)', () => {
    expect(findQuoteStart('Our revenue trippled in the third quarter', SEGMENTS)).toBe(3);
  });

  it('returns null for words that are not in the recording', () => {
    expect(findQuoteStart('We surveyed two thousand customers across eleven states.', SEGMENTS)).toBeNull();
  });

  it('returns null on empty inputs', () => {
    expect(findQuoteStart('', SEGMENTS)).toBeNull();
    expect(findQuoteStart('anything', [])).toBeNull();
  });
});
