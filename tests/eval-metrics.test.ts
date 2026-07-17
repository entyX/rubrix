/**
 * The eval harness is the ship gate; its arithmetic has to be right, or it green-lights
 * a bad prompt. These pin the metric math against known values.
 */
import { describe, it, expect } from 'vitest';
import { pearson, mae, median, spread, mean, inBand, mustMention } from '@/lib/eval/metrics';

describe('pearson', () => {
  it('is 1 for a perfect positive line', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });
  it('is -1 for a perfect negative line', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });
  it('matches a known worked example', () => {
    // r for these is 0.9819805…
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])).toBeCloseTo(0.7745966, 5);
  });
  it('is NaN for a constant series (zero variance) — never a passing 0', () => {
    expect(Number.isNaN(pearson([5, 5, 5], [1, 2, 3]))).toBe(true);
  });
  it('is NaN for fewer than 2 points', () => {
    expect(Number.isNaN(pearson([1], [1]))).toBe(true);
  });
});

describe('mae', () => {
  it('averages absolute differences', () => {
    expect(mae([10, 20, 30], [12, 18, 33])).toBeCloseTo((2 + 2 + 3) / 3, 10);
  });
  it('is 0 for identical series', () => {
    expect(mae([1, 2, 3], [1, 2, 3])).toBe(0);
  });
});

describe('median & spread', () => {
  it('median of odd and even length', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it('spread is max minus min', () => {
    expect(spread([70, 72, 68])).toBe(4);
    expect(spread([80])).toBe(0);
  });
  it('mean', () => {
    expect(mean([2, 4, 6])).toBe(4);
  });
});

describe('inBand', () => {
  it('inclusive of the edges', () => {
    expect(inBand(55, 55, 70)).toBe(true);
    expect(inBand(70, 55, 70)).toBe(true);
    expect(inBand(54.9, 55, 70)).toBe(false);
    expect(inBand(70.1, 55, 70)).toBe(false);
  });
});

describe('mustMention', () => {
  const parts = [
    'You cited the 41% waste reduction from your two-week pilot.',
    'Name the exact Gini coefficient next time.',
  ];
  it('counts hits case- and punctuation-insensitively', () => {
    const r = mustMention(['41%', 'two week pilot', 'gini coefficient'], parts);
    expect(r.hits).toBe(3);
    expect(r.missed).toHaveLength(0);
  });
  it('reports misses', () => {
    const r = mustMention(['carbon plate', '41%'], parts);
    expect(r.hits).toBe(1);
    expect(r.missed).toEqual(['carbon plate']);
  });
});
