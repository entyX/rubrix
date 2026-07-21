/**
 * POST /api/visual — the open-source eyes (DECISIONS D-018).
 *
 * SERVER ONLY. This is where OPENROUTER_API_KEY lives; it never reaches the browser.
 *
 * Takes the still frames the browser sampled across the WHOLE run (one per ~8s) and
 * returns the vision model's visual-delivery report. A separate request from /api/grade
 * on purpose: the platform caps a request body at 4.5MB, and sharing that budget with
 * the audio was why the judge used to see only 5–9 stills of a 15-minute run.
 *
 * Frames live in this request and nowhere else — never stored (D-015's rule holds).
 * When no OPENROUTER_API_KEY is set, this returns 503 and the client falls back to
 * attaching frames straight to the grading call, exactly as before.
 */
import { randomUUID } from 'node:crypto';

import { buildVisualReport, type VisualFrame } from '@/lib/ai/visual';
import { hasOpenRouter } from '@/lib/ai/openrouter';

export const maxDuration = 300;
export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!hasOpenRouter()) {
    return Response.json(
      {
        error: {
          code: 'no_visual_provider',
          message: 'Visual analysis is not configured on this server.',
        },
      },
      { status: 503 },
    );
  }

  const form = await req.formData();
  const runId = randomUUID().slice(0, 8);

  const durationRaw = String(form.get('durationS') ?? '');
  const durationS = durationRaw === '' ? null : Number(durationRaw);

  const frames: VisualFrame[] = [];
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

  if (frames.length === 0) {
    return Response.json(
      { error: { code: 'no_frames', message: 'No frames were included in that upload.' } },
      { status: 400 },
    );
  }

  try {
    const analysis = await buildVisualReport({ frames, durationS, runId });
    console.log(
      `[providers] run=${runId} visual=openrouter/${analysis.model} frames=${analysis.frameCount} cost=${analysis.costCents.toFixed(3)}c`,
    );
    return Response.json({
      report: analysis.report,
      frame_count: analysis.frameCount,
      cost_cents: Number(analysis.costCents.toFixed(3)),
      provider: 'openrouter',
      model: analysis.model,
    });
  } catch (err) {
    console.error(`[api/visual] run=${runId} failed (${frames.length} frames):`, err);
    return Response.json(
      {
        error: {
          code: 'visual_failed',
          message: "We couldn't analyze your video frames this time.",
          // Surfaced so the browser console shows WHY (e.g. an OpenRouter 5xx / payload).
          detail: `${err instanceof Error ? err.message : String(err)} (frames=${frames.length})`,
        },
      },
      { status: 502 },
    );
  }
}
