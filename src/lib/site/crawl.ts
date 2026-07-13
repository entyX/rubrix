/**
 * Website capture — the submission path for prejudged events (plan.md §3, format
 * `prejudged_plus_presentation`; F4 "link" submissions).
 *
 * Takes a live URL or a local folder of source files and produces everything the
 * judge needs to score a website rubric:
 *   - the real source code (HTML/CSS/JS)          -> code criteria
 *   - rendered screenshots at 3 viewports          -> design + platform criteria
 *   - console errors                               -> interactivity criteria
 *   - the visible text                             -> content/grammar/citation criteria
 *
 * A local folder is served over a throwaway localhost server so relative links,
 * stylesheets and scripts resolve exactly as they would in a browser.
 */
import { chromium, type Browser, type ConsoleMessage } from 'playwright';
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { extname, join, normalize, resolve, sep } from 'node:path';

export interface Viewport {
  name: 'mobile' | 'tablet' | 'desktop';
  width: number;
  height: number;
}

export const VIEWPORTS: Viewport[] = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
];

export interface Shot {
  viewport: Viewport['name'];
  /** JPEG, base64. */
  base64: string;
  /** True when content spills sideways — the classic "not actually responsive" tell. */
  horizontalOverflow: boolean;
}

export interface PageCapture {
  url: string;
  title: string;
  status: number;
  html: string;
  text: string;
  consoleErrors: string[];
  shots: Shot[];
}

export interface Asset {
  url: string;
  kind: 'css' | 'js';
  /** Whether it was a separate file or embedded in the HTML — the §"Style" criterion. */
  external: boolean;
  content: string;
}

export interface SiteCapture {
  entry: string;
  pages: PageCapture[];
  assets: Asset[];
  /** Everything a quote could legitimately come from. Used for the §9.7 grounding check. */
  corpus: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Serve a local folder so a website built on disk behaves like a deployed one. */
async function serveFolder(dir: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const root = resolve(dir);

  const server: Server = createServer((req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let rel = normalize(raw).replace(/^([/\\])+/, '');
    if (rel === '' || rel.endsWith(sep) || rel.endsWith('/')) rel = join(rel, 'index.html');

    const file = resolve(root, rel);
    // Never serve outside the folder the user pointed at.
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end('forbidden');
      return;
    }

    void (async () => {
      try {
        const s = await stat(file);
        const target = s.isDirectory() ? join(file, 'index.html') : file;
        const body = await readFile(target);
        res.writeHead(200, { 'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    })();
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('Could not start the local preview server.');

  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Shrink screenshots so a 6-image submission doesn't blow the token budget. */
async function shrink(png: Buffer): Promise<string> {
  const sharpMod = (await import('sharp')).default;
  const jpg = await sharpMod(png).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
  return jpg.toString('base64');
}

export async function captureSite(
  target: string,
  opts: { maxPages?: number } = {},
): Promise<SiteCapture> {
  const maxPages = opts.maxPages ?? 4;

  const isUrl = /^https?:\/\//i.test(target);
  let origin: string;
  let closeServer: (() => Promise<void>) | null = null;

  if (isUrl) {
    origin = target;
  } else {
    const served = await serveFolder(target);
    origin = served.origin;
    closeServer = served.close;
  }

  let browser: Browser | null = null;
  const pages: PageCapture[] = [];
  const assets: Asset[] = [];
  const seenAssets = new Set<string>();

  try {
    browser = await chromium.launch();

    // ---- discover pages (same-origin only)
    //
    // "/" and "/index.html" are the same page. Without collapsing them the homepage
    // gets crawled twice and every metric derived from it (images, console errors,
    // inline style blocks) silently doubles.
    const canonical = (u: string) =>
      u
        .replace(/#.*$/, '')
        .replace(/\?.*$/, '')
        .replace(/\/index\.html?$/i, '/')
        .replace(/\/+$/, '');

    const queue: string[] = [origin];
    const visited = new Set<string>();

    while (queue.length > 0 && pages.length < maxPages) {
      const url = queue.shift()!;
      const key = canonical(url);
      if (visited.has(key)) continue;
      visited.add(key);

      const context = await browser.newContext({ viewport: VIEWPORTS[2] });
      const page = await context.newPage();

      const consoleErrors: string[] = [];
      page.on('console', (m: ConsoleMessage) => {
        if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
      });
      page.on('pageerror', (e: Error) => consoleErrors.push(e.message.slice(0, 300)));

      let status = 0;
      try {
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
        status = resp?.status() ?? 0;
      } catch (err) {
        await context.close();
        if (pages.length === 0) {
          throw new Error(
            `We couldn't reach ${url}. Double-check it's publicly reachable, or pass a local folder instead. (${(err as Error).message.split('\n')[0]})`,
          );
        }
        continue;
      }

      const html = await page.content();
      const text = (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 20_000);
      const title = await page.title();

      // ---- screenshots. Homepage gets all three viewports; inner pages get desktop.
      const wanted = pages.length === 0 ? VIEWPORTS : [VIEWPORTS[2]];
      const shots: Shot[] = [];
      for (const vp of wanted) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(250);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        );
        const png = await page.screenshot({ fullPage: true, type: 'png' });
        shots.push({ viewport: vp.name, base64: await shrink(png), horizontalOverflow: overflow });
      }
      await page.setViewportSize(VIEWPORTS[2]);

      // ---- source assets referenced by this page
      const refs = await page.evaluate(() => {
        const css = [...document.querySelectorAll('link[rel="stylesheet"]')].map(
          (l) => (l as HTMLLinkElement).href,
        );
        const js = [...document.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src);
        return { css, js };
      });

      for (const [kind, urls] of [
        ['css', refs.css],
        ['js', refs.js],
      ] as const) {
        for (const a of urls) {
          if (seenAssets.has(a) || !a.startsWith(new URL(origin).origin)) continue;
          seenAssets.add(a);
          try {
            const r = await page.request.get(a);
            assets.push({ url: a, kind, external: true, content: (await r.text()).slice(0, 30_000) });
          } catch {
            /* asset unreachable; the deterministic metrics will notice */
          }
        }
      }

      // ---- same-origin links to crawl next
      const links: string[] = await page.evaluate(
        () => [...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href),
      );
      const base = new URL(origin).origin;
      for (const l of links) {
        if (!l.startsWith(base)) continue;
        if (/\.(pdf|zip|png|jpe?g|gif|svg)$/i.test(l)) continue;
        if (visited.has(canonical(l))) continue;
        queue.push(l);
      }

      pages.push({ url, title, status, html, text, consoleErrors, shots });
      await context.close();
    }
  } finally {
    await browser?.close();
    await closeServer?.();
  }

  if (pages.length === 0) throw new Error('Nothing could be loaded from that site.');

  const corpus = [
    ...pages.map((p) => `${p.title}\n${p.text}\n${p.html}`),
    ...assets.map((a) => a.content),
  ].join('\n\n');

  return { entry: target, pages, assets, corpus };
}

export { path };
