/**
 * Deterministic website metrics — the website analogue of plan.md §9.2.
 *
 * Same principle: "code, not the LLM — trustworthy, injected into grading."
 * Whether a stylesheet is a separate file, whether an image has alt text, whether
 * the page overflows sideways on a phone, how many console errors fired — these are
 * FACTS. We measure them and hand the judge the answer. We never ask a model to
 * squint at a screenshot and guess.
 *
 * This is what makes a website rubric gradeable at all: several criteria on the
 * FBLA sheet ("Style", "compatible with multiple platforms", "interactivity is
 * error free", accessibility) are close to fully determined by these numbers.
 */
import type { SiteCapture } from './crawl';

export interface SiteMetrics {
  pages_crawled: number;
  page_urls: string[];
  all_pages_ok: boolean;

  // "Style" criterion — is the code actually separated into files?
  external_stylesheets: number;
  external_scripts: number;
  inline_style_blocks: number;
  inline_script_blocks: number;
  inline_style_attributes: number;
  languages_separated: boolean;
  code_comment_lines: number;

  // "Interactivity functions and is error free"
  console_errors: number;
  console_error_samples: string[];

  // "Compatible with multiple platforms"
  renders_mobile: boolean;
  renders_tablet: boolean;
  renders_desktop: boolean;
  horizontal_overflow_on: string[];

  // Accessibility / usability
  images_total: number;
  images_with_alt: number;
  alt_text_coverage_pct: number;
  aria_attributes: number;
  landmark_elements: number;
  has_lang_attribute: boolean;
  form_inputs: number;
  form_inputs_labelled: number;

  // "Elements are consistent across all pages"
  nav_present_on_all_pages: boolean;
  consistent_nav_across_pages: boolean;

  // Content
  total_word_count: number;
  outbound_links: number;

  notes: string[];
}

const count = (haystack: string, re: RegExp) => (haystack.match(re) ?? []).length;

export function computeSiteMetrics(site: SiteCapture): SiteMetrics {
  const notes: string[] = [];
  const html = site.pages.map((p) => p.html).join('\n');

  // ---- code separation ("Style")
  const externalStylesheets = site.assets.filter((a) => a.kind === 'css').length;
  const externalScripts = site.assets.filter((a) => a.kind === 'js').length;
  const inlineStyleBlocks = count(html, /<style[\s>]/gi);
  // <script> with no src= is an inline block.
  const inlineScriptBlocks = count(html, /<script(?![^>]*\bsrc=)[^>]*>/gi);
  const inlineStyleAttrs = count(html, /\sstyle\s*=\s*["']/gi);

  const languagesSeparated =
    (externalStylesheets > 0 || inlineStyleBlocks === 0) &&
    (externalScripts > 0 || inlineScriptBlocks === 0) &&
    inlineStyleBlocks === 0 &&
    inlineScriptBlocks === 0;

  if (!languagesSeparated) {
    notes.push(
      `Code is not fully separated: ${inlineStyleBlocks} inline <style> block(s), ${inlineScriptBlocks} inline <script> block(s), ${inlineStyleAttrs} inline style="" attribute(s).`,
    );
  }

  const allCode = site.assets.map((a) => a.content).join('\n');
  const codeComments =
    count(allCode, /\/\*[\s\S]*?\*\//g) + count(allCode, /(^|\s)\/\/.*$/gm) + count(html, /<!--[\s\S]*?-->/g);

  // ---- console errors
  const consoleErrors = site.pages.flatMap((p) => p.consoleErrors);

  // ---- responsiveness
  const home = site.pages[0];
  const shotFor = (v: string) => home.shots.find((s) => s.viewport === v);
  const overflowOn = site.pages
    .flatMap((p) => p.shots.filter((s) => s.horizontalOverflow).map((s) => `${p.url} (${s.viewport})`))
    .slice(0, 6);

  if (overflowOn.length > 0) {
    notes.push(`Content spills sideways (horizontal scroll) on: ${overflowOn.join(', ')}.`);
  }

  // ---- accessibility
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const imagesWithAlt = imgTags.filter((t) => /\balt\s*=\s*["'][^"']/i.test(t)).length;
  const altCoverage = imgTags.length === 0 ? 100 : (imagesWithAlt / imgTags.length) * 100;

  const aria = count(html, /\saria-[a-z]+\s*=/gi) + count(html, /\srole\s*=\s*["']/gi);
  const landmarks = count(html, /<(header|nav|main|footer|aside|section)\b/gi);
  const hasLang = /<html[^>]*\blang\s*=\s*["'][a-z]/i.test(html);

  const inputs = html.match(/<(input|select|textarea)\b[^>]*>/gi) ?? [];
  const labelled = inputs.filter(
    (t) => /\baria-label(ledby)?\s*=/i.test(t) || /\bid\s*=\s*["']([^"']+)["']/i.test(t),
  ).length;

  if (imgTags.length > 0 && altCoverage < 100) {
    notes.push(`${imgTags.length - imagesWithAlt} of ${imgTags.length} images have no alt text.`);
  }
  if (!hasLang) notes.push('The <html> element has no lang attribute.');

  // ---- cross-page consistency
  const navSignatures = site.pages.map((p) => {
    const nav = /<nav\b[\s\S]*?<\/nav>/i.exec(p.html)?.[0] ?? '';
    // Signature = the set of link targets in the nav, order-independent.
    const hrefs = [...nav.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    return hrefs.sort().join('|');
  });
  const navPresentOnAll = navSignatures.every((s) => s !== '');
  const consistentNav = navPresentOnAll && new Set(navSignatures).size === 1;

  if (site.pages.length > 1 && !consistentNav) {
    notes.push('Navigation differs between pages (or is missing on some) — check element consistency.');
  }

  const words = site.pages.reduce(
    (a, p) => a + (p.text.trim() === '' ? 0 : p.text.trim().split(/\s+/).length),
    0,
  );

  const origin = /^https?:\/\//i.test(site.entry) ? new URL(site.entry).origin : null;
  const allHrefs = [...html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]);
  const outbound = allHrefs.filter((h) => (origin ? !h.startsWith(origin) : true)).length;

  return {
    pages_crawled: site.pages.length,
    page_urls: site.pages.map((p) => p.url),
    all_pages_ok: site.pages.every((p) => p.status >= 200 && p.status < 400),

    external_stylesheets: externalStylesheets,
    external_scripts: externalScripts,
    inline_style_blocks: inlineStyleBlocks,
    inline_script_blocks: inlineScriptBlocks,
    inline_style_attributes: inlineStyleAttrs,
    languages_separated: languagesSeparated,
    code_comment_lines: codeComments,

    console_errors: consoleErrors.length,
    console_error_samples: consoleErrors.slice(0, 5),

    renders_mobile: shotFor('mobile') !== undefined,
    renders_tablet: shotFor('tablet') !== undefined,
    renders_desktop: shotFor('desktop') !== undefined,
    horizontal_overflow_on: overflowOn,

    images_total: imgTags.length,
    images_with_alt: imagesWithAlt,
    alt_text_coverage_pct: Number(altCoverage.toFixed(1)),
    aria_attributes: aria,
    landmark_elements: landmarks,
    has_lang_attribute: hasLang,
    form_inputs: inputs.length,
    form_inputs_labelled: labelled,

    nav_present_on_all_pages: navPresentOnAll,
    consistent_nav_across_pages: consistentNav,

    total_word_count: words,
    outbound_links: outbound,

    notes,
  };
}
