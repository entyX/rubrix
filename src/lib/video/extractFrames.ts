/**
 * Client-side keyframe extraction — the judge's "eyes" (D-015, D-018, D-023, D-024).
 *
 * PRIVACY (opt-in amendment to a rule the spec calls non-negotiable, §20):
 *   The video FILE is never uploaded — frames are sampled IN THE BROWSER and only those
 *   stills (with the audio) are sent, then discarded. Nothing is stored.
 *
 * TWO decoders, tried in order, because no single one reads every file (D-024):
 *   1. ffmpeg.wasm via per-timestamp SEEKING (fast software decode of most formats).
 *   2. the browser <video> element (HARDWARE decode — the only thing that reads an iPhone
 *      HEVC .mov on many platforms), bounded by timeouts so it can never hang.
 * Whichever yields frames wins; if neither does, the run grades audio-only and the console
 * says why (ffmpeg's own log is surfaced).
 */
import { loadFfmpeg } from '@/lib/audio/extractAudio';
import { fetchFile } from '@ffmpeg/util';

export interface Frame {
  blob: Blob;
  atSeconds: number;
}

/**
 * Default density: one frame every ~8s, 640px longest edge. The default cap is 24, but the
 * caller sets both (D-034, the "thoroughness" choice on the confirm screen) — Deep/Max pull
 * far more. The old single-request 502 wall no longer bounds this: the caller now ships the
 * frames to /api/visual in batches of <=16 and merges the reports, so a higher count is only
 * a longer in-browser extraction, never a crash.
 */
export const FRAME_INTERVAL_S = 8;
export const MIN_FRAMES = 9;
export const MAX_FRAMES = 24;

/** How many stills honestly cover a run of this length. Pure — unit-tested. */
export function samplePlan(
  durationS: number,
  maxFrames: number = MAX_FRAMES,
  intervalS: number = FRAME_INTERVAL_S,
): number {
  const floor = Math.min(MIN_FRAMES, maxFrames);
  if (!Number.isFinite(durationS) || durationS <= 0) return floor;
  return Math.min(maxFrames, Math.max(floor, Math.round(durationS / intervalS)));
}

/** Frame timestamps at slice midpoints — avoids a black first frame and a frozen last one. */
function sampleTimes(durationS: number, maxFrames: number, intervalS: number): number[] {
  const count = samplePlan(durationS, maxFrames, intervalS);
  return Array.from({ length: count }, (_, i) => (durationS * (i + 0.5)) / count);
}

export interface FrameOptions {
  /** Run length in seconds — from the extracted audio. Sets how many frames and where. */
  durationS: number;
  /** Longest edge, px. */
  maxEdge: number;
  /** Wall-clock budget per decoder (ms). On timeout we return what we have — never hang. */
  budgetMs: number;
  /** D-034: max stills to sample (thoroughness). Higher = finer coverage, longer wait. */
  maxFrames: number;
  /** D-034: target seconds between stills; the real count is min(maxFrames, dur/intervalS). */
  intervalS: number;
  /** 0–1 progress, called after each frame. */
  onProgress?: (ratio: number) => void;
}

const DEFAULTS: Omit<FrameOptions, 'durationS' | 'onProgress'> = {
  maxEdge: 640,
  budgetMs: 35_000,
  maxFrames: MAX_FRAMES,
  intervalS: FRAME_INTERVAL_S,
};

/**
 * Sample still frames across the WHOLE run. ffmpeg first (fast, most formats), then the
 * browser <video> decoder (HEVC and anything the OS can play). Returns [] on an audio-only
 * file or when neither decoder can read the video — the caller then grades audio-only.
 */
export async function extractFrames(
  file: File | Blob,
  opts: Partial<FrameOptions> = {},
): Promise<Frame[]> {
  const o = { ...DEFAULTS, ...opts, durationS: opts.durationS ?? 0 };
  if (o.durationS <= 0) return []; // no way to place frames — grade audio-only

  const viaFfmpeg = await extractFramesFfmpeg(file, o).catch((e) => {
    console.warn('[frames] ffmpeg path errored:', e);
    return [] as Frame[];
  });
  if (viaFfmpeg.length > 0) return viaFfmpeg;

  console.warn('[frames] ffmpeg produced no frames — trying the browser <video> decoder (handles HEVC via hardware on supported platforms)');
  return extractFramesViaVideo(file, o).catch((e) => {
    console.warn('[frames] <video> path errored:', e);
    return [] as Frame[];
  });
}

/** ffmpeg.wasm, per-timestamp input seek. Surfaces ffmpeg's own log if it yields nothing. */
async function extractFramesFfmpeg(file: File | Blob, o: FrameOptions): Promise<Frame[]> {
  const ff = await loadFfmpeg();
  const name = file instanceof File ? file.name : 'input';
  const ext = name.includes('.') ? name.split('.').pop()! : 'webm';
  const inName = `frames-in.${ext}`;

  const logs: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    logs.push(message);
    if (logs.length > 80) logs.shift();
  };
  ff.on('log', onLog);

  try {
    await ff.writeFile(inName, await fetchFile(file));
    const times = sampleTimes(o.durationS, o.maxFrames, o.intervalS);
    console.info(`[frames] ffmpeg: sampling ${times.length} frames across ~${Math.round(o.durationS)}s`);

    const started = Date.now();
    const frames: Frame[] = [];
    for (let i = 0; i < times.length; i++) {
      if (Date.now() - started > o.budgetMs) {
        console.warn(`[frames] ffmpeg: time budget reached, stopping at ${frames.length} frame(s)`);
        break;
      }
      const t = times[i];
      const out = `f${i}.jpg`;
      try {
        // -ss BEFORE -i = fast input seek. This is the canonical single-frame command;
        // do NOT add -y (this emscripten build aborts with "Unrecognized option 'y'")
        // or -update (unneeded for -frames:v 1). Output names are unique, so no overwrite.
        await ff.exec([
          '-ss', t.toFixed(2),
          '-i', inName,
          '-frames:v', '1',
          '-vf', `scale=${o.maxEdge}:${o.maxEdge}:force_original_aspect_ratio=decrease`,
          '-q:v', '5',
          out,
        ]);
        const data = await ff.readFile(out).catch(() => null);
        await ff.deleteFile(out).catch(() => {});
        if (data instanceof Uint8Array && data.byteLength > 0) {
          frames.push({ blob: new Blob([data as unknown as BlobPart], { type: 'image/jpeg' }), atSeconds: t });
        }
      } catch {
        // one bad seek shouldn't sink the batch
      }
      o.onProgress?.((i + 1) / times.length);
      // Bail early if the codec is clearly undecodable (first several seeks all empty) —
      // saves ~30s of futile seeks before the <video> fallback runs.
      if (i === 5 && frames.length === 0) {
        console.warn('[frames] ffmpeg: first 6 seeks empty — likely a codec it cannot decode; falling back early');
        break;
      }
    }

    if (frames.length === 0) {
      console.warn(
        '[frames] ffmpeg wrote no frames. Its log (a codec it cannot decode, e.g. HEVC, looks like ' +
          '"decoder not found" / "no frame"):\n' + logs.slice(-20).join('\n'),
      );
    } else {
      console.info(`[frames] ffmpeg: got ${frames.length} frame(s)`);
    }
    return frames;
  } finally {
    ff.off('log', onLog);
    await ff.deleteFile(inName).catch(() => {});
  }
}

/** Wait for a media event, resolving false (not throwing) on error/timeout so the caller degrades. */
function awaitEvent(el: HTMLMediaElement, ok: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      el.removeEventListener(ok, onOk);
      el.removeEventListener('error', onErr);
      clearTimeout(t);
      resolve(v);
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const t = setTimeout(() => done(false), timeoutMs);
    el.addEventListener(ok, onOk);
    el.addEventListener('error', onErr);
  });
}

/** The browser <video>+canvas path — hardware decode, bounded so it can't hang (D-024). */
async function extractFramesViaVideo(file: File | Blob, o: FrameOptions): Promise<Frame[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    const loaded = await awaitEvent(video, 'loadedmetadata', 15_000);
    if (!loaded) {
      console.warn('[frames] <video>: this browser could not load the video (timeout or decode error)');
      return [];
    }
    if (!video.videoWidth || !video.videoHeight) return []; // audio-only or undecodable

    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : o.durationS;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, o.maxEdge / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const times = sampleTimes(dur, o.maxFrames, o.intervalS);
    console.info(`[frames] <video>: sampling ${times.length} frames across ~${Math.round(dur)}s`);

    const started = Date.now();
    const frames: Frame[] = [];
    for (let i = 0; i < times.length; i++) {
      if (Date.now() - started > o.budgetMs) break;
      const seeked = await new Promise<boolean>((resolve) => {
        const done = (v: boolean) => {
          video.removeEventListener('seeked', onOk);
          video.removeEventListener('error', onErr);
          clearTimeout(to);
          resolve(v);
        };
        const onOk = () => done(true);
        const onErr = () => done(false);
        const to = setTimeout(() => done(false), 8_000);
        video.addEventListener('seeked', onOk);
        video.addEventListener('error', onErr);
        video.currentTime = Math.min(times[i], dur - 0.05);
      });
      if (seeked) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.7));
        if (blob) frames.push({ blob, atSeconds: times[i] });
      }
      o.onProgress?.((i + 1) / times.length);
    }
    console.info(`[frames] <video>: got ${frames.length} frame(s)`);
    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Keep the whole upload under the platform's request-body cap. Frames travel to
 * /api/visual in their own request (D-018), so audioBytes is usually 0 here.
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
