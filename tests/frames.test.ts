/**
 * D-018 — the judge must see the WHOLE run. samplePlan decides how many stills that
 * honestly takes; trimFramesToBudget keeps an upload under the platform body cap
 * while preserving an even spread.
 */
import { describe, it, expect } from 'vitest';
import {
  samplePlan,
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

  it('samples one frame per interval on a mid-length run', () => {
    expect(samplePlan(300)).toBe(Math.round(300 / FRAME_INTERVAL_S));
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
