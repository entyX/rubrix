/**
 * The visual delivery report — the judge's EYES, open-source edition (DECISIONS D-018).
 *
 * SERVER ONLY.
 *
 * Frames sampled across the WHOLE run (every ~8s in the browser, up to 60) go to the
 * open-source vision model (Qwen3-VL via OpenRouter), which writes a timestamped,
 * observations-only report. The Gemini judge then scores visual criteria FROM THE
 * REPORT, and §9.7 grounds every source-"visual" quote against the rendered report
 * text — closing the loophole where raw-frame observations skipped the hallucination
 * check entirely.
 *
 * Same §9.7 discipline as every other model boundary: Zod parse, one corrective
 * retry, never trust the output.
 */
import { orGenerate } from './openrouter';
import { OPENROUTER_VISION_MODEL, type TokenUsage, ZERO_USAGE, addUsage } from './models';
import { VISUAL_SYSTEM, buildVisualUser, validationRetryMessage, PROMPT_VERSION_VISUAL } from './prompts';
import { VisualReportJSON, VISUAL_RESPONSE_SCHEMA } from './schemas';
import { parseModelJson } from './json';
import { mmss } from '@/lib/transcript/format';
import type { ImagePart } from './gemini';

/** Output cap for the report. Observations for 60 frames + patterns is well under this. */
const MAX_VISUAL_OUTPUT_TOKENS = 6_000;

export interface VisualAnalysis {
  report: VisualReportJSON;
  frameCount: number;
  usage: TokenUsage;
  costCents: number;
  /** Whether the Zod retry fired — same cost-leak visibility rule as grading (D-010). */
  retryUsed: boolean;
  /** Which eye ran (D-023) — the OpenRouter vision model that produced this report. */
  model: string;
}

export interface VisualFrame {
  base64: string;
  mimeType: string;
  atSeconds: number;
}

/**
 * Render the report as deterministic text. This exact text is BOTH what the judge
 * reads and the §9.7 grounding corpus for "visual" evidence — they must be the same
 * string, or honest verbatim quotes would be stripped as hallucinations.
 */
export function renderVisualReport(report: VisualReportJSON): string {
  const lines: string[] = [];
  lines.push(`Footage quality: ${report.video_quality}`);
  lines.push('');
  lines.push('Observed moments:');
  for (const o of report.observations) lines.push(`[${mmss(o.at_s)}] ${o.note}`);
  lines.push('');
  lines.push('Across the run:');
  lines.push(`Posture: ${report.patterns.posture}`);
  lines.push(`Gestures: ${report.patterns.gestures}`);
  lines.push(`Eye line: ${report.patterns.eye_line}`);
  lines.push(`Attire: ${report.patterns.attire}`);
  lines.push(`Setting and visual aids: ${report.patterns.setting_and_aids}`);
  lines.push(`Movement: ${report.patterns.movement}`);
  if (report.cannot_see.length > 0) {
    lines.push('');
    lines.push('Cannot be established from still frames:');
    for (const c of report.cannot_see) lines.push(`- ${c}`);
  }
  return lines.join('\n');
}

/**
 * frames -> VisualReportJSON via the open-source vision model, with one corrective
 * retry on a Zod failure (§9.7 step 1, same shape as grading's loop).
 */
export async function buildVisualReport(args: {
  frames: VisualFrame[];
  durationS: number | null;
  runId: string;
}): Promise<VisualAnalysis> {
  const { frames, durationS, runId } = args;
  if (frames.length === 0) throw new Error('No frames to analyze.');

  const images: ImagePart[] = frames.map((f) => ({
    base64: f.base64,
    mimeType: f.mimeType,
    caption: `Frame at ${mmss(f.atSeconds)}:`,
  }));

  const user = buildVisualUser({ frameCount: frames.length, durationS });

  let usage: TokenUsage = ZERO_USAGE;
  let cost = 0;
  let correction = '';
  let retryUsed = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await orGenerate({
      model: OPENROUTER_VISION_MODEL,
      system: VISUAL_SYSTEM,
      user: correction === '' ? user : `${user}\n\n${correction}`,
      responseSchema: VISUAL_RESPONSE_SCHEMA,
      schemaName: 'visual_delivery_report',
      maxOutputTokens: MAX_VISUAL_OUTPUT_TOKENS,
      temperature: 0, // an observer, not an author — no creativity wanted
      seed: 7,
      images,
      promptVersion: PROMPT_VERSION_VISUAL,
      runId,
      label: attempt === 0 ? 'visual' : 'visual:retry',
    });
    usage = addUsage(usage, res.usage);
    cost += res.costCents;

    const parsed = parseModelJson(res.text, VisualReportJSON);
    if (!parsed.ok) {
      if (attempt === 1) {
        throw new Error(`The vision model returned an unusable report: ${parsed.issues}`);
      }
      retryUsed = true;
      console.warn(`[visual] run=${runId} schema retry — ${parsed.issues}`);
      correction = validationRetryMessage(parsed.issues);
      continue;
    }

    return {
      report: parsed.value,
      frameCount: frames.length,
      usage,
      costCents: cost,
      retryUsed,
      model: OPENROUTER_VISION_MODEL,
    };
  }

  // Unreachable — attempt 1 either returns or throws — but TypeScript can't see that.
  throw new Error('The vision model returned an unusable report.');
}
