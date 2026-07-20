/**
 * POST /api/grade — the whole judge, as one streamed request.
 *
 * SERVER ONLY. This is where GEMINI_API_KEY lives; it never reaches the browser.
 *
 * Takes the mp3 the browser already extracted (the original video never leaves the
 * student's machine — CLAUDE.md) plus a rubric id, and streams back NDJSON progress
 * so the UI can show the real stage it's on rather than a decorative spinner:
 *
 *   {"stage":"transcribing"} ... {"stage":"judging"} ... {"stage":"done","result":{...}}
 *
 * plan.md §15 copy deck is used verbatim for the stage labels.
 */
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { transcribeAudio } from '@/lib/ai/transcribe';
import { computeDeliveryMetrics } from '@/lib/metrics/delivery';
import { gradeSubmission, type Submission } from '@/lib/ai/grade';
import { generateQA } from '@/lib/ai/qa';
import { RubricJSON, VisualReportJSON } from '@/lib/ai/schemas';
import { GEMINI_MODEL } from '@/lib/ai/models';

/** plan.md §8: grading route maxDuration 300s. */
export const maxDuration = 300;
export const runtime = 'nodejs';

const RUBRIC_DIR = 'rubrics';

export async function GET() {
  // The rubric picker needs the list. Cheap enough to read from disk each time.
  const files = (await readdir(RUBRIC_DIR)).filter((f) => f.endsWith('.rubric.json'));
  const rubrics = [];
  for (const f of files) {
    const parsed = RubricJSON.safeParse(JSON.parse(await readFile(path.join(RUBRIC_DIR, f), 'utf8')));
    if (!parsed.success) continue;
    rubrics.push({
      id: f,
      title: parsed.data.title,
      total_points: parsed.data.total_points,
      criteria_count: parsed.data.criteria.length,
      is_placeholder: f.startsWith('_dev-'),
    });
  }
  return Response.json({ rubrics });
}

export async function POST(req: Request) {
  const form = await req.formData();

  const audio = form.get('audio');
  const rubricId = String(form.get('rubricId') ?? '');
  const eventName = String(form.get('eventName') ?? 'Sales Presentation');
  const org = String(form.get('org') ?? 'fbla');
  const teamSize = Number(form.get('teamSize') ?? 1);
  const limitRaw = String(form.get('timeLimitS') ?? '');
  const timeLimitS = limitRaw === '' ? null : Number(limitRaw);

  if (!(audio instanceof File)) {
    return Response.json(
      { error: { code: 'no_audio', message: 'No recording was included in that upload.' } },
      { status: 400 },
    );
  }
  // Path traversal guard — rubricId comes from the client. Shape is exactly
  // {org}/{category}/{slug}.rubric.json; no "..", no absolute paths, nothing else.
  if (!/^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9._-]+\.rubric\.json$/i.test(rubricId)) {
    return Response.json(
      { error: { code: 'bad_rubric', message: 'That rubric does not look right.' } },
      { status: 400 },
    );
  }

  let rubric;
  try {
    const raw = JSON.parse(await readFile(path.join(RUBRIC_DIR, rubricId), 'utf8'));

    // plan.md F3, enforced server-side — the UI gate is not the security boundary.
    // A machine-parsed rubric nobody has checked must never put a number on a student.
    if (raw?._review?.status === 'unreviewed') {
      return Response.json(
        {
          error: {
            code: 'unreviewed_rubric',
            message:
              'This rubric was machine-read from the rating sheet and nobody has checked it yet. Review and confirm it before grading against it.',
          },
        },
        { status: 409 },
      );
    }

    const parsed = RubricJSON.safeParse(raw);
    if (!parsed.success) throw new Error('invalid');
    rubric = parsed.data;
  } catch (err) {
    if (err instanceof Response) throw err;
    return Response.json(
      { error: { code: 'bad_rubric', message: "We couldn't load that rubric." } },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await audio.arrayBuffer());
  const runId = randomUUID().slice(0, 8);

  // The visual delivery report from /api/visual (DECISIONS D-018) — the open-source
  // vision model already watched the whole run; the judge grades from its report.
  let visual: Submission['visual'];
  const visualRaw = form.get('visualReport');
  if (typeof visualRaw === 'string' && visualRaw !== '') {
    try {
      const parsedVisual = VisualReportJSON.safeParse(JSON.parse(visualRaw));
      if (parsedVisual.success) {
        visual = {
          report: parsedVisual.data,
          frameCount: Number(form.get('visualFrameCount') ?? 0) || parsedVisual.data.observations.length,
        };
      } else {
        console.warn('[api/grade] visualReport failed validation — grading without it');
      }
    } catch {
      console.warn('[api/grade] visualReport was not valid JSON — grading without it');
    }
  }

  // Pre-submission materials (D-019): extracted text from /api/presubmission, riding
  // along as a string. Criteria about the prejudged document become gradeable.
  let materials: Submission['materials'];
  const matText = form.get('materialsText');
  const matName = form.get('materialsName');
  if (typeof matText === 'string' && matText.trim().length >= 50) {
    materials = {
      name: typeof matName === 'string' && matName !== '' ? matName.slice(0, 120) : 'document',
      text: matText.slice(0, 80_000),
    };
  }

  // Opt-in video frames (DECISIONS D-015), the fallback path when no report exists.
  // Stills only — the video file is never uploaded. Used for this grade and discarded.
  const frames: Array<{ base64: string; mimeType: string; atSeconds: number }> = [];
  for (const [key, val] of form.entries()) {
    if (key.startsWith('frame_') && val instanceof File) {
      // Timestamp is the filename ("72.jpg"); the field name is just a unique index.
      const atSeconds = Number(val.name.replace(/\.[a-z]+$/i, '')) || 0;
      frames.push({
        base64: Buffer.from(await val.arrayBuffer()).toString('base64'),
        mimeType: val.type || 'image/jpeg',
        atSeconds,
      });
    }
  }
  frames.sort((a, b) => a.atSeconds - b.atSeconds);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));

      try {
        // Summed from each call's own accounting — Whisper bills per audio hour, not
        // in Gemini tokens (D-018), so recomputing from token usage would under-report.
        let cents = 0;

        // plan.md §15 loading-stage copy, verbatim.
        send({ stage: 'transcribing', label: 'Transcribing your run…' });
        const tr = await transcribeAudio(bytes, audio.type || 'audio/mpeg', runId);
        cents += tr.costCents;

        const metrics = computeDeliveryMetrics(tr.transcript, tr.durationS, timeLimitS);
        const submission: Submission = {
          presentation: { transcript: tr.transcript, metrics },
          ...(visual ? { visual } : {}),
          ...(frames.length ? { frames } : {}),
          ...(materials ? { materials } : {}),
        };
        send({ stage: 'transcribed', metrics, warnings: tr.timestampWarnings });

        send({ stage: 'judging', label: 'Judging against the rubric…' });
        const graded = await gradeSubmission({
          rubric,
          submission,
          event: { org, eventName, timeLimitS, teamSize, scoreAnchors: '' },
          runId,
        });
        cents += graded.costCents;

        send({ stage: 'qa', label: 'Writing your Q&A grill…' });
        const qa = await generateQA({
          grading: graded.result,
          qaFormatDescription:
            'Judges question the competitor after the presentation; questions probe the decisions behind the pitch and understanding of the product.',
          runId,
        });
        cents += qa.costCents;

        send({
          stage: 'done',
          result: {
            run_id: runId,
            model_version: GEMINI_MODEL,
            prompt_version: graded.promptVersion,
            rubric,
            result: graded.result,
            qa: qa.qa,
            validation: graded.report,
            transcript: tr.transcript,
            metrics,
            visual_report: visual?.report ?? null,
            cost_cents: Number(cents.toFixed(3)),
          },
        });
      } catch (err) {
        // §15: friendly, specific, second person. Never a raw error string.
        const message =
          err instanceof Error ? err.message : 'Something broke on our end. It\'s logged and we\'re on it.';
        console.error(`[api/grade] run failed:`, err);
        send({ stage: 'failed', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
