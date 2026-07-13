/**
 * GET  /api/rubrics?id=...  — fetch a rubric so a human can review the parse.
 * POST /api/rubrics         — confirm it (optionally with corrections).
 *
 * plan.md F3: "never grade on an unreviewed parse." This route is the gate. Nothing can
 * grade a student until a human has looked at the machine's reading of the rating sheet
 * and said yes.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { RubricJSON } from '@/lib/ai/schemas';

export const runtime = 'nodejs';

/** Shape is exactly {org}/{category}/{slug}.rubric.json — no traversal. */
const ID = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9._-]+\.rubric\.json$/i;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!ID.test(id)) {
    return Response.json({ error: { code: 'bad_id', message: 'Unknown rubric.' } }, { status: 400 });
  }
  try {
    const raw = JSON.parse(await readFile(path.join('rubrics', id), 'utf8'));
    return Response.json({ rubric: raw });
  } catch {
    return Response.json(
      { error: { code: 'not_found', message: "We couldn't find that rubric." } },
      { status: 404 },
    );
  }
}

const ConfirmBody = z.object({
  id: z.string().regex(ID),
  /** Optional corrections from the review table. Omit to confirm the parse as-is. */
  rubric: RubricJSON.optional(),
});

export async function POST(req: Request) {
  const parsed = ConfirmBody.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'bad_body', message: 'That rubric does not look right.' } },
      { status: 400 },
    );
  }
  const { id, rubric } = parsed.data;

  try {
    const file = path.join('rubrics', id);
    const current = JSON.parse(await readFile(file, 'utf8'));

    // Validate whatever we're about to bless. A confirmed rubric that fails RubricJSON
    // would blow up at grade time, in front of a student.
    const next = rubric ?? current;
    const check = RubricJSON.safeParse(next);
    if (!check.success) {
      return Response.json(
        {
          error: {
            code: 'invalid_rubric',
            message: 'That rubric is not valid — fix the flagged rows before confirming.',
            issues: check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          },
        },
        { status: 400 },
      );
    }

    await writeFile(
      file,
      JSON.stringify(
        {
          ...current,
          ...check.data,
          _review: {
            ...(current._review ?? {}),
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
            warnings: current._review?.warnings ?? [],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[api/rubrics] confirm failed', err);
    return Response.json(
      { error: { code: 'server', message: "Something broke on our end. It's logged." } },
      { status: 500 },
    );
  }
}
