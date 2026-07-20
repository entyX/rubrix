/**
 * §9.7 step 1 — the JSON gate. D-018 hardened it: stray prose around an object is
 * salvaged, but a TRUNCATED object is still rejected (half a grade parsed
 * "successfully" would be a wrong score), now with a diagnosis that names the cause.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseModelJson, stripFences } from '@/lib/ai/json';

const Shape = z.object({ score: z.number(), note: z.string() });

describe('parseModelJson', () => {
  it('parses clean JSON', () => {
    const out = parseModelJson('{"score": 7, "note": "ok"}', Shape);
    expect(out.ok).toBe(true);
  });

  it('strips markdown fences', () => {
    const out = parseModelJson('```json\n{"score": 7, "note": "ok"}\n```', Shape);
    expect(out.ok).toBe(true);
  });

  it('salvages an object wrapped in stray prose', () => {
    const out = parseModelJson(
      'Here is the JSON you asked for: {"score": 7, "note": "ok"} Hope that helps!',
      Shape,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.score).toBe(7);
  });

  it('rejects truncated JSON and names truncation as the likely cause', () => {
    const out = parseModelJson('{"score": 7, "note": "this run was cut off mid-str', Shape);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues).toContain('truncated');
  });

  it('still reports Zod issues on a well-formed but wrong-shaped object', () => {
    const out = parseModelJson('{"score": "seven", "note": "ok"}', Shape);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues).toContain('score');
  });
});

describe('stripFences', () => {
  it('leaves unfenced text alone', () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
  it('removes a labelled fence', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});
