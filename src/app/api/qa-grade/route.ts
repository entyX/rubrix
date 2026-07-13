/**
 * POST /api/qa-grade — re-grade once the student has answered the judge's questions.
 *
 * SERVER ONLY.
 *
 * The first grade leaves question-answering criteria unscored, because the student was
 * never asked anything (prompt rule 5b). This route takes their answers — typed, dictated,
 * or spoken into a recording — and re-runs the judge with the Q&A session attached, so
 * those criteria become scoreable for real.
 *
 * Answers may arrive as text, or as an audio file per question (which we transcribe here).
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { transcribeAudio } from '@/lib/ai/transcribe';
import { computeDeliveryMetrics } from '@/lib/metrics/delivery';
import { gradeSubmission, type Submission } from '@/lib/ai/grade';
import { RubricJSON, TranscriptJSON } from '@/lib/ai/schemas';
import { addUsage, costCents, ZERO_USAGE, GEMINI_MODEL } from '@/lib/ai/models';
import { z } from 'zod';

export const maxDuration = 300;
export const runtime = 'nodejs';

const Body = z.object({
  rubricId: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9._-]+\.rubric\.json$/i),
  eventName: z.string(),
  org: z.string(),
  timeLimitS: z.number().nullable(),
  transcript: TranscriptJSON,
  durationS: z.number().positive(),
  answers: z.array(z.object({ question: z.string(), answer: z.string().min(1) })).min(1),
});

export async function POST(req: Request) {
  const form = await req.formData();

  // Answers can be typed OR spoken. Spoken ones arrive as audio and get transcribed here.
  const payloadRaw = form.get('payload');
  if (typeof payloadRaw !== 'string') {
    return Response.json(
      { error: { code: 'bad_body', message: "We couldn't read that submission." } },
      { status: 400 },
    );
  }

  let payload: z.infer<typeof Body>;
  const runId = randomUUID().slice(0, 8);
  let usage = ZERO_USAGE;

  try {
    const draft = JSON.parse(payloadRaw) as unknown;

    // Any question answered by voice recording: transcribe it, then treat it as text.
    const parsedDraft = draft as { answers?: Array<{ question: string; answer: string }> };
    if (Array.isArray(parsedDraft.answers)) {
      for (let i = 0; i < parsedDraft.answers.length; i++) {
        const clip = form.get(`audio_${i}`);
        if (clip instanceof File && clip.size > 0) {
          const bytes = Buffer.from(await clip.arrayBuffer());
          const tr = await transcribeAudio(bytes, clip.type || 'audio/mpeg', runId);
          usage = addUsage(usage, tr.usage);
          parsedDraft.answers[i].answer = tr.transcript.full_text;
        }
      }
    }

    const parsed = Body.safeParse(parsedDraft);
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'bad_body',
            message: 'Answer every question before sending it to the judge.',
            issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          },
        },
        { status: 400 },
      );
    }
    payload = parsed.data;
  } catch (err) {
    console.error('[api/qa-grade] bad payload', err);
    return Response.json(
      { error: { code: 'bad_body', message: "We couldn't read your answers." } },
      { status: 400 },
    );
  }

  let rubric;
  try {
    const raw = JSON.parse(await readFile(path.join('rubrics', payload.rubricId), 'utf8'));
    if (raw?._review?.status !== 'confirmed') {
      return Response.json(
        {
          error: {
            code: 'unreviewed_rubric',
            message: 'This rubric has not been reviewed yet, so it cannot grade anyone.',
          },
        },
        { status: 409 },
      );
    }
    const p = RubricJSON.safeParse(raw);
    if (!p.success) throw new Error('invalid');
    rubric = p.data;
  } catch {
    return Response.json(
      { error: { code: 'bad_rubric', message: "We couldn't load that rubric." } },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(o)}\n`));
      try {
        send({ stage: 'judging', label: 'Judging your answers…' });

        const metrics = computeDeliveryMetrics(
          payload.transcript,
          payload.durationS,
          payload.timeLimitS,
        );
        const submission: Submission = {
          presentation: { transcript: payload.transcript, metrics },
          qa: payload.answers,
        };

        const graded = await gradeSubmission({
          rubric,
          submission,
          event: {
            org: payload.org,
            eventName: payload.eventName,
            timeLimitS: payload.timeLimitS,
            teamSize: 1,
            scoreAnchors: '',
          },
          runId,
        });
        usage = addUsage(usage, graded.usage);

        send({
          stage: 'done',
          result: {
            run_id: runId,
            model_version: GEMINI_MODEL,
            prompt_version: graded.promptVersion,
            rubric,
            result: graded.result,
            validation: graded.report,
            transcript: payload.transcript,
            metrics,
            cost_cents: Number(costCents(usage).toFixed(3)),
          },
        });
      } catch (err) {
        console.error('[api/qa-grade] failed', err);
        send({
          stage: 'failed',
          message: err instanceof Error ? err.message : 'The judge stumbled on this one.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}
