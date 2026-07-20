/**
 * POST /api/export — the whole report as one PDF (D-020).
 *
 * The client posts back the run it's displaying (there's no database yet — M2 —
 * so the browser holds the only copy), the shape is Zod-verified, and the PDF is
 * rendered deterministically by src/lib/pdf/report.ts. Nothing is stored.
 */
import { z } from 'zod';

import { renderReportPdf } from '@/lib/pdf/report';
import { GradingResultJSON, QAJSON, RubricJSON, TranscriptJSON } from '@/lib/ai/schemas';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** A 20-minute run's full payload is ~300KB; anything past this is not a report. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const ExportBody = z.object({
  event: z.object({ name: z.string().min(1).max(160), org: z.string().min(1).max(20) }),
  run: z.object({
    run_id: z.string().max(40),
    model_version: z.string().max(80),
    prompt_version: z.string().max(40),
    rubric: RubricJSON,
    result: GradingResultJSON,
    qa: QAJSON,
    transcript: TranscriptJSON,
    metrics: z.object({
      duration_s: z.number(),
      words_per_minute: z.number(),
      filler_count: z.number(),
      fillers_per_minute: z.number(),
      longest_pause_s: z.number(),
    }),
    validation: z.object({
      hallucinated_quotes_stripped: z.number(),
      not_assessable_points: z.number(),
      timestamps_realigned: z.number().optional(),
      time_cuts_stripped: z.number().optional(),
    }),
    cost_cents: z.number(),
  }),
});

export async function POST(req: Request) {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    return Response.json(
      { error: { code: 'too_big', message: 'That report is too large to export.' } },
      { status: 413 },
    );
  }

  let parsed;
  try {
    parsed = ExportBody.safeParse(await req.json());
  } catch {
    return Response.json(
      { error: { code: 'bad_body', message: "We couldn't read that report." } },
      { status: 400 },
    );
  }
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'bad_body',
          message: "That report doesn't look right. Re-run the grade and try again.",
          issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
        },
      },
      { status: 400 },
    );
  }

  try {
    const bytes = await renderReportPdf(parsed.data);
    return new Response(Buffer.from(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="rubrix-report.pdf"',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[api/export] failed:', err);
    return Response.json(
      { error: { code: 'export_failed', message: "We couldn't build the PDF this time." } },
      { status: 500 },
    );
  }
}
