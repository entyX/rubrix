/**
 * Client-side keyframe extraction — the "eyes" for the judge (DECISIONS D-015).
 *
 * PRIVACY (opt-in amendment to a rule the spec calls non-negotiable, §20):
 *   The video FILE is never uploaded. We sample still frames IN THE BROWSER — one every
 *   ~8 seconds, so the whole run is covered (D-018) — send only those stills (with the
 *   audio) to be graded, and discard them. Nothing is stored. This only runs when the
 *   student explicitly consents.
 *
 * We use a <video> element + <canvas> rather than ffmpeg.wasm: the browser already decodes
 * mp4/mov/webm it can play, seeking + drawing is lighter than a second wasm pass, and it
 * avoids re-muxing a minor's video through anything.
 */

export interface Frame {
  blob: Blob;
  atSeconds: number;
}

export interface FrameOptions {
  /** How many stills to sample across the run. 0 = decide from the duration (samplePlan). */
  count: number;
  /** Longest edge, px. Enough to read expression/eye line; small enough to stay under the upload cap. */
  maxEdge: number;
  /** JPEG quality 0–1. */
  quality: number;
}

/**
 * D-018: frames go to the open-source vision model in their OWN request, so the
 * count is no longer squeezed into the same 4.5MB body as the audio. One frame
 * every ~8s covers the whole run; 640px at q0.62 keeps ~60 frames near 3MB.
 */
export const FRAME_INTERVAL_S = 8;
export const MIN_FRAMES = 9;
export const MAX_FRAMES = 60;

/** How many stills honestly cover a run of this length. Pure — unit-tested. */
export function samplePlan(durationS: number): number {
  if (!Number.isFinite(durationS) || durationS <= 0) return MIN_FRAMES;
  return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(durationS / FRAME_INTERVAL_S)));
}

const DEFAULTS: FrameOptions = { count: 0, maxEdge: 640, quality: 0.62 };

function once(el: HTMLMediaElement, event: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const on = () => {
      el.removeEventListener(event, on);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      el.removeEventListener(event, on);
      reject(new Error(`video "${event}" timed out`));
    }, timeoutMs);
    el.addEventListener(event, on);
  });
}

/**
 * MediaRecorder webm blobs report `duration = Infinity` until the video has been seeked to
 * the end (a long-standing Chromium quirk). Force it to resolve.
 */
async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  return new Promise<number>((resolve) => {
    const onChange = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.removeEventListener('durationchange', onChange);
        video.currentTime = 0;
        resolve(video.duration);
      }
    };
    video.addEventListener('durationchange', onChange);
    video.currentTime = 1e101; // seek way past the end to make the browser compute duration
  });
}

async function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  const p = once(video, 'seeked');
  video.currentTime = t;
  await p;
}

/**
 * Sample evenly-spaced still frames from a video file/blob, in the browser.
 * Returns [] when the file has no video track (e.g. an audio-only upload) — the caller
 * then just grades audio-only.
 */
export async function extractFrames(
  file: File | Blob,
  opts: Partial<FrameOptions> = {},
): Promise<Frame[]> {
  const o = { ...DEFAULTS, ...opts };
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await once(video, 'loadedmetadata');

    // No picture in this file (audio-only). Grade audio-only.
    if (!video.videoWidth || !video.videoHeight) return [];

    const duration = await resolveDuration(video);
    if (!Number.isFinite(duration) || duration <= 0) return [];

    const count = o.count > 0 ? o.count : samplePlan(duration);

    // Sample at the midpoint of N even slices — avoids a black first frame and a frozen last one.
    const times = Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, o.maxEdge / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const frames: Frame[] = [];
    for (const t of times) {
      await seekTo(video, Math.min(t, duration - 0.05));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/jpeg', o.quality),
      );
      if (blob) frames.push({ blob, atSeconds: t });
    }
    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Keep the whole upload under the platform's request-body cap.
 *
 * Vercel caps a serverless body at 4.5MB. Audio is the big part; frames are the extra.
 * If audio + frames would blow the budget, drop frames evenly (never below a floor) so a
 * long run still grades — just with fewer stills — rather than dying on a 413. Audio that
 * is on its own too big is caught separately in extractAudio.
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
    // Drop every other frame, keeping an even spread across the run.
    kept = kept.filter((_, i) => i % 2 === 0);
  }
  // Still over even at the floor? Drop from the end until it fits (or nothing's left).
  while (total(kept) > budgetBytes && kept.length > 0) kept = kept.slice(0, -1);
  return kept;
}
