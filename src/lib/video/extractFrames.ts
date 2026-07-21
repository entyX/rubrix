/**
 * Client-side keyframe extraction — the judge's "eyes" (DECISIONS D-015, D-018, D-023).
 *
 * PRIVACY (opt-in amendment to a rule the spec calls non-negotiable, §20):
 *   The video FILE is never uploaded. We sample still frames IN THE BROWSER and send only
 *   those stills (with the audio) to be graded, then discard them. Nothing is stored.
 *
 * HOW (D-023, corrected): we extract with ffmpeg.wasm — the instance already loaded to pull
 * the audio — using per-timestamp INPUT SEEKING (`-ss` BEFORE `-i`). Each sample seeks to a
 * keyframe near the target time and decodes ~one frame, so a 10-minute video costs ~50 quick
 * seeks, NOT a full decode of all ~18,000 frames (the `fps` filter's fatal slowness, which
 * looked "stuck"). Seeking also handles the large / HEVC files the browser's <video> element
 * stalled on (the `loadedmetadata timed out` hang). A wall-clock budget guarantees it can
 * never hang the UI: on timeout it returns the frames gathered so far.
 */
import { loadFfmpeg } from '@/lib/audio/extractAudio';
import { fetchFile } from '@ffmpeg/util';

export interface Frame {
  blob: Blob;
  atSeconds: number;
}

/** One frame every ~8s covers the run; 640px longest edge keeps ~60 frames near 3MB. */
export const FRAME_INTERVAL_S = 8;
export const MIN_FRAMES = 9;
export const MAX_FRAMES = 60;

/** How many stills honestly cover a run of this length. Pure — unit-tested. */
export function samplePlan(durationS: number): number {
  if (!Number.isFinite(durationS) || durationS <= 0) return MIN_FRAMES;
  return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(durationS / FRAME_INTERVAL_S)));
}

export interface FrameOptions {
  /** Length of the run in seconds — from the extracted audio. Sets how many frames and where. */
  durationS: number;
  /** Longest edge, px. Enough to read expression/eye line; small enough to stay small. */
  maxEdge: number;
  /** Wall-clock budget (ms). On timeout we return what we have — never hang the UI. */
  budgetMs: number;
  /** 0–1 progress, called after each frame. */
  onProgress?: (ratio: number) => void;
}

const DEFAULTS: Omit<FrameOptions, 'durationS' | 'onProgress'> = { maxEdge: 640, budgetMs: 55_000 };

/**
 * Sample still frames across the WHOLE run via fast ffmpeg seeks. Returns [] when there's no
 * usable duration hint or no video stream (audio-only) — the caller then grades audio-only.
 */
export async function extractFrames(
  file: File | Blob,
  opts: Partial<FrameOptions> = {},
): Promise<Frame[]> {
  const o = { ...DEFAULTS, ...opts };
  const durationS = o.durationS && o.durationS > 0 ? o.durationS : 0;
  if (durationS <= 0) return []; // no way to place frames — grade audio-only

  const ff = await loadFfmpeg();
  const name = file instanceof File ? file.name : 'input';
  const ext = name.includes('.') ? name.split('.').pop()! : 'webm';
  const inName = `frames-in.${ext}`;

  try {
    await ff.writeFile(inName, await fetchFile(file));

    const count = samplePlan(durationS);
    // Sample at the midpoint of N even slices — avoids a black first frame and a frozen last.
    const times = Array.from({ length: count }, (_, i) => (durationS * (i + 0.5)) / count);
    console.info(`[frames] sampling ${count} frames across ~${Math.round(durationS)}s`);

    const started = Date.now();
    const frames: Frame[] = [];
    for (let i = 0; i < times.length; i++) {
      if (Date.now() - started > o.budgetMs) {
        console.warn(`[frames] time budget reached — stopping at ${frames.length} frame(s)`);
        break;
      }
      const t = times[i];
      const out = `f${i}.jpg`;
      try {
        // -ss BEFORE -i = input seek: jump to a keyframe near t, decode ~one frame. Fast.
        await ff.exec([
          '-ss', t.toFixed(2),
          '-i', inName,
          '-frames:v', '1',
          '-vf', `scale=${o.maxEdge}:${o.maxEdge}:force_original_aspect_ratio=decrease`,
          '-q:v', '6',
          '-y', out,
        ]);
        const data = await ff.readFile(out).catch(() => null);
        await ff.deleteFile(out).catch(() => {});
        if (data instanceof Uint8Array && data.byteLength > 0) {
          frames.push({
            blob: new Blob([data as unknown as BlobPart], { type: 'image/jpeg' }),
            atSeconds: t,
          });
        }
      } catch {
        // A single bad seek shouldn't sink the batch — skip this frame and keep going.
      }
      o.onProgress?.((i + 1) / times.length);
    }

    console.info(`[frames] got ${frames.length} frame(s)`);
    return frames;
  } finally {
    await ff.deleteFile(inName).catch(() => {});
  }
}

/**
 * Keep the whole upload under the platform's request-body cap.
 *
 * Frames now travel to /api/visual in their OWN request (D-018), so audioBytes is usually 0
 * here — this just caps the total frame payload. Drops frames evenly (never below a floor) so
 * a long run still grades with fewer stills rather than dying on a 413.
 */
export function trimFramesToBudget(
  frames: Frame[],
  audioBytes: number,
  budgetBytes = 4.2 * 1024 * 1024,
  floor = 5,
): Frame[] {
  const total = (fs: Frame[]) => audioBytes + fs.reduce((a, f) => a + f.blob.size, 0);
  let kept = frames;
  while (total(kept) > budgetBytes && kept.length > floor) {
    kept = kept.filter((_, i) => i % 2 === 0); // drop every other, keep an even spread
  }
  while (total(kept) > budgetBytes && kept.length > 0) kept = kept.slice(0, -1);
  return kept;
}
