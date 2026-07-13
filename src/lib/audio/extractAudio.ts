/**
 * Client-side audio extraction — plan.md §6 / §9.1, and a HARD privacy rule.
 *
 * CLAUDE.md, non-negotiable:
 *   "Original video never stored. Audio only (mp3), extracted client-side via
 *    ffmpeg.wasm. The video file never touches our servers."
 *
 * So this runs in the BROWSER. The video is decoded on the student's own machine and
 * only the resulting mono 64kbps mp3 is ever uploaded. A 15-minute talk lands around
 * 7MB, comfortably inside the request cap.
 *
 * Lazy-loaded (§11.7: "ffmpeg.wasm lazy-loaded ONLY on the judge page") — this module
 * must never be imported at the top level of a page.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

async function load(onLog?: (line: string) => void): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  const instance = new FFmpeg();
  if (onLog) instance.on('log', ({ message }) => onLog(message));
  // Served from our own origin (see scripts/copy-ffmpeg.mjs) — no CDN, so a filtered
  // school network can't silently break this.
  await instance.load({
    coreURL: '/ffmpeg/ffmpeg-core.js',
    wasmURL: '/ffmpeg/ffmpeg-core.wasm',
  });
  ffmpeg = instance;
  return instance;
}

export interface ExtractProgress {
  /** 0–1, or null while ffmpeg is still loading. */
  ratio: number | null;
  stage: 'loading' | 'extracting' | 'done';
}

/**
 * Any audio/video file -> mono 64kbps mp3, entirely in the browser.
 * The exact flags from plan.md §9.1: -vn -ac 1 -ar 16000 -b:a 64k
 */
export async function extractAudio(
  file: File | Blob,
  onProgress?: (p: ExtractProgress) => void,
): Promise<Blob> {
  onProgress?.({ ratio: null, stage: 'loading' });
  const ff = await load();

  const handler = ({ progress }: { progress: number }) => {
    onProgress?.({ ratio: Math.min(1, Math.max(0, progress)), stage: 'extracting' });
  };
  ff.on('progress', handler);

  const name = file instanceof File ? file.name : 'input';
  const ext = name.includes('.') ? name.split('.').pop()! : 'webm';
  const inName = `in.${ext}`;
  const outName = 'out.mp3';

  try {
    await ff.writeFile(inName, await fetchFile(file));
    onProgress?.({ ratio: 0, stage: 'extracting' });

    await ff.exec([
      '-i', inName,
      '-vn',            // drop any video stream — it must never leave this machine
      '-ac', '1',       // mono
      '-ar', '16000',   // 16 kHz is plenty for speech
      '-b:a', '64k',
      outName,
    ]);

    const data = await ff.readFile(outName);
    onProgress?.({ ratio: 1, stage: 'done' });

    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    return new Blob([bytes as unknown as BlobPart], { type: 'audio/mpeg' });
  } finally {
    ff.off('progress', handler);
    // Don't leave the student's video sitting in the wasm filesystem.
    await ff.deleteFile(inName).catch(() => {});
    await ff.deleteFile(outName).catch(() => {});
  }
}
