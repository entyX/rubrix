/**
 * plan.md §9.7 step 1: "Zod parse (strip accidental ``` fences first)."
 *
 * responseSchema makes fenced output unlikely, but "unlikely" is not "impossible"
 * and a fence would otherwise crash the grader on a run the student paid for.
 */
import type { z } from 'zod';

export function stripFences(raw: string): string {
  let t = raw.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return t.trim();
}

export type ParseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; issues: string };

export function parseModelJson<T>(raw: string, schema: z.ZodType<T>): ParseOutcome<T> {
  const text = stripFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Last-resort repair: some failures are stray prose around an otherwise-valid
    // object ("Here is the JSON: {...} Hope that helps!"). Try the outermost braces
    // before giving up. A TRUNCATED object still fails here — by design: half a
    // grade parsed "successfully" would be a wrong score, not a save.
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        parsed = JSON.parse(text.slice(first, last + 1));
      } catch {
        parsed = undefined;
      }
    }
    if (parsed === undefined) {
      const truncated = !text.trimEnd().endsWith('}');
      return {
        ok: false,
        issues:
          `not valid JSON (${(err as Error).message})` +
          (truncated ? ' — output does not end in "}", likely truncated at the token cap' : ''),
      };
    }
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    return { ok: false, issues };
  }
  return { ok: true, value: result.data };
}
