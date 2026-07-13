/**
 * Copy the ffmpeg.wasm core into /public so the browser loads it from our own origin.
 *
 * Not a CDN: a school network that filters unpkg would otherwise break audio extraction
 * silently, and plan.md §20 explicitly warns "some districts filter aggressively".
 * Runs on predev/prebuild.
 */
import { mkdir, copyFile } from 'node:fs/promises';

const SRC = 'node_modules/@ffmpeg/core/dist/umd';
const DEST = 'public/ffmpeg';

await mkdir(DEST, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  await copyFile(`${SRC}/${f}`, `${DEST}/${f}`);
}
console.log(`ffmpeg core -> ${DEST}`);
