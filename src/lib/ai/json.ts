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
    return { ok: false, issues: `not valid JSON (${(err as Error).message})` };
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
