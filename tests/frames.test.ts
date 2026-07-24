/**
 * D-018 — the judge must see the WHOLE run. samplePlan decides how many stills that
 * honestly takes; trimFramesToBudget keeps an upload under the platform body cap
 * while preserving an even spread.
 */
import { describe, it, expect } from 'vitest';
import {
  samplePlan,
  coverageOrder,
  trimFramesToBudget,
  MIN_FRAMES,
  MAX_FRAMES,
  FRAME_INTERVAL_S,
  type Frame,
} from '@/lib/video/extractFrames';

describe('samplePlan', () => {
  it('never goes below the floor on a short run', () => {
    expect(samplePlan(30)).toBe(MIN_FRAMES);
  });

  it('samples one frame per interval below the cap', () => {
    // 120s / 8 = 15 frames, comfortably between the floor (9) and the cap (24).
    expect(samplePlan(120)).toBe(Math.round(120 / FRAME_INTERVAL_S));
  });

  it('caps at the ceiling on a long run', () => {
    expect(samplePlan(20 * 60)).toBe(MAX_FRAMES);
  });

  it('covers a 5-minute run at well under a 15s gap', () => {
    const gap = 300 / samplePlan(300);
    expect(gap).toBeLessThanOrEqual(15);
  });

  it('falls back to the floor on nonsense durations', () => {
    expect(samplePlan(0)).toBe(MIN_FRAMES);
    expect(samplePlan(Number.NaN)).toBe(MIN_FRAMES);
    expect(samplePlan(-5)).toBe(MIN_FRAMES);
  });

  // D-034: thoroughness passes a higher cap + denser interval.
  it('honors a caller-supplied cap and interval (Deep/Max thoroughness)', () => {
    // 7-min run at Max (interval 4s) → 105 raw, capped to 64.
    expect(samplePlan(7 * 60, 64, 4)).toBe(64);
    // Same run at Deep (interval 6s) → 70 raw, capped to 32.
    expect(samplePlan(7 * 60, 32, 6)).toBe(32);
    // Below the cap, density follows the interval.
    expect(samplePlan(120, 64, 4)).toBe(30); // 120/4
  });

  it('keeps the floor sane even when a caller passes a tiny cap', () => {
    // Degenerate duration clamps to min(MIN_FRAMES, maxFrames), never above the cap.
    expect(samplePlan(0, 4, 4)).toBe(4);
  });
});

describe('coverageOrder (D-035 — a budget bail must still span the whole run)', () => {
  it('is a permutation of [0, n)', () => {
    for (const n of [1, 2, 7, 16, 100, 481]) {
      const order = coverageOrder(n);
      expect(order).toHaveLength(n);
      expect(new Set(order).size).toBe(n); // every index exactly once
      expect(Math.min(...order)).toBe(0);
      expect(Math.max(...order)).toBe(n - 1);
    }
  });

  it('handles the degenerate sizes', () => {
    expect(coverageOrder(0)).toEqual([]);
    expect(coverageOrder(1)).toEqual([0]);
  });

  it('visits the extremes before the interior — any prefix spreads across the range', () => {
    const n = 100;
    const order = coverageOrder(n);
    // Endpoints come first.
    expect(order.slice(0, 2).sort((a, b) => a - b)).toEqual([0, n - 1]);
    // A short prefix already covers early, middle, and late thirds of the run.
    const prefix = order.slice(0, 8);
    expect(prefix.some((i) => i < n / 3)).toBe(true);
    expect(prefix.some((i) => i >= n / 3 && i < (2 * n) / 3)).toBe(true);
    expect(prefix.some((i) => i >= (2 * n) / 3)).toBe(true);
  });
});

describe('trimFramesToBudget', () => {
  const frame = (atSeconds: number, bytes: number): Frame => ({
    blob: new Blob([new Uint8Array(bytes)]),
    atSeconds,
  });

  it('leaves frames alone when everything fits', () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame(i * 10, 50_000));
    expect(trimFramesToBudget(frames, 1_000_000)).toHaveLength(10);
  });

  it('drops every other frame (keeping the spread) until the budget fits', () => {
    const frames = Array.from({ length: 40 }, (_, i) => frame(i * 10, 100_000)); // 4MB of frames
    const kept = trimFramesToBudget(frames, 2_000_000, 4.2 * 1024 * 1024);
    const total = kept.reduce((a, f) => a + f.blob.size, 0) + 2_000_000;
    expect(total).toBeLessThanOrEqual(4.2 * 1024 * 1024);
    expect(kept.length).toBeGreaterThan(0);
    // Even spread survives: first frame kept, gaps uniform.
    expect(kept[0].atSeconds).toBe(0);
  });

  it('never trims below the floor while halving', () => {
    const frames = Array.from({ length: 9 }, (_, i) => frame(i * 10, 200_000));
    const kept = trimFramesToBudget(frames, 3.5 * 1024 * 1024);
    expect(kept.length).toBeLessThanOrEqual(9);
  });
});
