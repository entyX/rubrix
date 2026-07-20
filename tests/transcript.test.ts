/**
 * D-018 — full_text is DERIVED from the segments, in code, always. The old shape had
 * the model write every word twice; besides the token cost, a divergence between
 * full_text and the segments would silently corrupt filler counts and §9.7 grounding.
 */
import { describe, it, expect } from 'vitest';
import { transcriptFromSegments } from '@/lib/transcript/format';

describe('transcriptFromSegments', () => {
  it('joins trimmed segment texts with single spaces', () => {
    const t = transcriptFromSegments([
      { start: 0, end: 3, text: '  Good morning judges. ' },
      { start: 3, end: 7, text: 'Um, our revenue tripled.' },
    ]);
    expect(t.full_text).toBe('Good morning judges. Um, our revenue tripled.');
    expect(t.segments).toHaveLength(2);
    expect(t.segments[0].text).toBe('Good morning judges.');
  });

  it('drops empty and whitespace-only segments', () => {
    const t = transcriptFromSegments([
      { start: 0, end: 2, text: 'Hello.' },
      { start: 2, end: 4, text: '   ' },
      { start: 4, end: 6, text: '' },
      { start: 6, end: 8, text: 'Goodbye.' },
    ]);
    expect(t.segments).toHaveLength(2);
    expect(t.full_text).toBe('Hello. Goodbye.');
  });

  it('returns an empty transcript for silence (the no-speech case, not an error)', () => {
    const t = transcriptFromSegments([]);
    expect(t.full_text).toBe('');
    expect(t.segments).toHaveLength(0);
  });

  it('preserves disfluencies verbatim — the delivery metrics count them', () => {
    const t = transcriptFromSegments([{ start: 0, end: 5, text: 'Um, uh, so like, you know.' }]);
    expect(t.full_text).toContain('Um, uh, so like, you know.');
  });
});
