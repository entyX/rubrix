/**
 * Client-side keyframe extraction — the "eyes" for the judge (DECISIONS D-015, D-023).
 *
 * PRIVACY (opt-in amendment to a rule the spec calls non-negotiable, §20):
 *   The video FILE is never uploaded. We sample still frames IN THE BROWSER — one every
 *   ~8 seconds, so the whole run is covered (D-018) — send only those stills (with the
 *   audio) to be graded, and discard them. Nothing is stored. This only runs when the
 *   student explicitly consents.
 *
 * PRIMARY PATH is ffmpeg.wasm (D-023): the same instance already loaded to pull the
 * audio, which decodes the large non-faststart mp4 and HEVC .mov files that made the
 * browser's <video> element hang on `loadedmetadata` (the "doesn't see the whole video"
 * bug). The old <video>+canvas path survives as a fallback — it re-muxes nothing either
 * way, so the privacy story is unchanged; it's purely a more capable decoder.
 */
import { loadFfmpeg } from '@/lib/audio/extractAudio';
import { fetchFile } from '@ffmpeg/util';

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
    const done = (fn: () => void) => {
      el.removeEventListener(event, on);
      el.removeEventListener('error', onError);
      clearTimeout(t);
      fn();
    };
    const on = () => done(resolve);
    // A codec the browser can't decode (e.g. HEVC .mov on Windows) fires 'error'
    // immediately — fail FAST with the real reason instead of hanging to the timeout.
    const onError = () =>
      done(() =>
        reject(
          new Error(
            `video decode failed (${el.error?.code ?? '?'}: ${el.error?.message || 'format not supported by this browser'})`,
          ),
        ),
      );
    const t = setTimeout(() => done(() => reject(new Error(`video "${event}" timed out`))), timeoutMs);
    el.addEventListener(event, on);
    el.addEventListener('error', onError);
  });
}

/**
 * MediaRecorder webm blobs report `duration = Infinity` until the video has been seeked to
 * the end (a long-standing Chromium quirk). Force it to resolve.
 */
async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  return new Promise<number>((resolve) => {
    // Never hang forever: if the browser can't compute a duration, give up and let
    // the caller return [] — the run proceeds audio-only rather than dying here.
    const t = setTimeout(() => {
      video.removeEventListener('durationchange', onChange);
      resolve(Number.NaN);
    }, 8_000);
    const onChange = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.removeEventListener('durationchange', onChange);
        clearTimeout(t);
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
 * Sample still frames across the WHOLE run. ffmpeg first (decodes what the browser
 * can't), then the <video> path as a fallback. Returns [] for an audio-only file.
 */
export async function extractFrames(
  file: File | Blob,
  opts: Partial<FrameOptions> = {},
): Promise<Frame[]> {
  try {
    const viaFfmpeg = await extractFramesFfmpeg(file, opts);
    if (viaFfmpeg.length > 0) return viaFfmpeg;
    // Zero frames from ffmpeg usually means "no video stream" (audio-only). Fall
    // through to <video> as a cheap sanity check; it also returns [] for audio-only.
  } catch (err) {
    console.warn('[frames] ffmpeg extraction failed, trying the <video> path:', err);
  }
  return extractFramesViaVideo(file, opts);
}

/**
 * ffmpeg.wasm frame extraction (D-023). One frame per FRAME_INTERVAL_S across the whole
 * input, longest edge capped at maxEdge, evenly downsampled to MAX_FRAMES. Uses the
 * shared instance from extractAudio, so the wasm core is already warm.
 */
export async function extractFramesFfmpeg(
  file: File | Blob,
  opts: Partial<FrameOptions> = {},
): Promise<Frame[]> {
  const o = { ...DEFAULTS, ...opts };
  const ff = await loadFfmpeg();
  const name = file instanceof File ? file.name : 'input';
  const ext = name.includes('.') ? name.split('.').pop()! : 'webm';
  const inName = `frames-in.${ext}`;

  try {
    await ff.writeFile(inName, await fetchFile(file));
    // fps=1/N → one frame every N seconds across the entire input; scale fits the
    // longer edge into maxEdge without upscaling small sources; -an drops audio.
    await ff.exec([
      '-i', inName,
      '-vf', `fps=1/${FRAME_INTERVAL_S},scale=${o.maxEdge}:${o.maxEdge}:force_original_aspect_ratio=decrease`,
      '-q:v', '6',
      '-an',
      'frame-%04d.jpg',
    ]);

    const entries = await ff.listDir('/');
    const names = entries
      .filter((e) => !e.isDir && /^frame-\d+\.jpg$/.test(e.name))
      .map((e) => e.name)
      .sort();
    if (names.length === 0) return []; // no video stream

    // Downsample evenly to the cap, preserving each kept frame's real timestamp.
    let indices = names.map((_, i) => i);
    if (indices.length > MAX_FRAMES) {
      indices = Array.from({ length: MAX_FRAMES }, (_, k) =>
        Math.round((k * (names.length - 1)) / (MAX_FRAMES - 1)),
      );
    }

    const frames: Frame[] = [];
    const seen = new Set<number>();
    for (const i of indices) {
      if (seen.has(i)) continue;
      seen.add(i);
      const data = await ff.readFile(names[i]);
      const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
      frames.push({
        blob: new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' }),
        atSeconds: i * FRAME_INTERVAL_S, // fps=1/N emits frame i at ~i·N seconds
      });
    }
    // Clean the frames out of the wasm FS — don't leave a minor's stills sitting there.
    for (const n of names) await ff.deleteFile(n).catch(() => {});
    return frames;
  } finally {
    await ff.deleteFile(inName).catch(() => {});
  }
}

/**
 * The original <video>+canvas path — fallback only (D-023). Kept because on the rare
 * file ffmpeg can't decode but the browser can, this still gets frames.
 * Returns [] when the file has no video track.
 */
export async function extractFramesViaVideo(
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
