/**
 * D-034 — batched visual analysis. When a run is watched at Deep/Max thoroughness the
 * frames are analysed in <=16-frame batches; mergeVisualReports stitches the per-batch
 * reports back into one whole-run report. These guard that stitch: observations are kept
 * and time-ordered, pattern detail is unioned (not lost), and dupes collapse.
 */
import { describe, it, expect } from 'vitest';
import { mergeVisualReports } from '@/lib/video/mergeVisualReports';
import { VisualReportJSON } from '@/lib/ai/schemas';

const batch = (over: Partial<VisualReportJSON>): VisualReportJSON => ({
  video_quality: 'clear',
  observations: [{ at_s: 0, note: 'x' }],
  patterns: {
    posture: '',
    gestures: '',
    eye_line: '',
    attire: '',
    setting_and_aids: '',
    movement: '',
  },
  cannot_see: [],
  ...over,
});

describe('mergeVisualReports', () => {
  it('passes a single report straight through', () => {
    const only = batch({ observations: [{ at_s: 3, note: 'stands up' }] });
    expect(mergeVisualReports([only])).toBe(only);
  });

  it('concatenates observations and time-orders them across batches', () => {
    const b1 = batch({ observations: [{ at_s: 90, note: 'gestures' }, { at_s: 10, note: 'opens' }] });
    const b2 = batch({ observations: [{ at_s: 200, note: 'closes' }, { at_s: 120, note: 'new slide' }] });
    const merged = mergeVisualReports([b1, b2]);
    expect(merged.observations.map((o) => o.at_s)).toEqual([10, 90, 120, 200]);
    expect(merged.observations).toHaveLength(4);
  });

  it('unions each pattern field so more frames add detail instead of overwriting it', () => {
    const early = batch({ patterns: { ...batch({}).patterns, posture: 'upright at the podium' } });
    const late = batch({ patterns: { ...batch({}).patterns, posture: 'leans on the table late on' } });
    const merged = mergeVisualReports([early, late]);
    expect(merged.patterns.posture).toBe('upright at the podium leans on the table late on');
  });

  it('dedupes identical pattern text, quality and cannot_see notes', () => {
    const a = batch({
      video_quality: 'clear',
      patterns: { ...batch({}).patterns, gestures: 'open hands' },
      cannot_see: ['sustained eye contact'],
    });
    const b = batch({
      video_quality: 'clear',
      patterns: { ...batch({}).patterns, gestures: 'open hands' },
      cannot_see: ['sustained eye contact', 'vocal tone'],
    });
    const merged = mergeVisualReports([a, b]);
    expect(merged.video_quality).toBe('clear'); // not "clear; clear"
    expect(merged.patterns.gestures).toBe('open hands'); // collapsed
    expect(merged.cannot_see).toEqual(['sustained eye contact', 'vocal tone']);
  });

  it('produces a schema-valid report (>=1 observation, all pattern fields present)', () => {
    const merged = mergeVisualReports([batch({}), batch({ observations: [{ at_s: 5, note: 'y' }] })]);
    const parsed = VisualReportJSON.safeParse(merged);
    expect(parsed.success).toBe(true);
  });

  it('caps a dense (1-fps Max) run to a usable report, still spanning end to end', () => {
    // 66 batches × 10 observations = 660 — more than the report should carry.
    const batches = Array.from({ length: 66 }, (_, b) =>
      batch({
        observations: Array.from({ length: 10 }, (_, k) => ({ at_s: b * 10 + k, note: `f${b}-${k}` })),
      }),
    );
    const merged = mergeVisualReports(batches);
    expect(merged.observations.length).toBeLessThanOrEqual(480);
    expect(merged.observations.length).toBeGreaterThan(300); // still richly detailed
    // Time-ordered, and the tail survives the downsample (coverage kept, not truncated).
    const times = merged.observations.map((o) => o.at_s);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBe(659);
  });
});
