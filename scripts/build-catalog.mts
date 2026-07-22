/**
 * Build the event catalog from the official rating-sheet PDFs.
 *
 * We do NOT guess at FBLA's event categories (CLAUDE.md: "Do not guess at FBLA rules").
 * Every guidelines PDF states its own category verbatim — "Event Category: Presentation",
 * "Event Category: Role Play", "Event Category: Chapter Event" — so we read that line and
 * use it. If a PDF doesn't state one, it lands in `unclassified` and a human decides.
 *
 * Output: rubrics/catalog.json  (read by the sidebar)
 * Run:    npm run catalog
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

const CATEGORIES = ['presentation', 'roleplay', 'chapter'] as const;
type Category = (typeof CATEGORIES)[number] | 'unclassified';

/** FBLA's own words -> our slug. */
function toCategory(raw: string): Category {
  const s = raw.toLowerCase();
  if (s.startsWith('role play')) return 'roleplay';
  if (s.startsWith('chapter')) return 'chapter';
  if (s.startsWith('presentation')) return 'presentation';
  return 'unclassified';
}

function titleCase(slug: string) {
  return slug
    .replace(/-/g, ' ')
    .replace(/\band\b/gi, '&')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Which events have pre-submission (prejudged) materials — AUTHORITATIVE, supplied by
 * a human from FBLA's official event list (D-022, 2026-07-20). Not guessed, not
 * extracted. The PDF-text cross-check below only WARNS on disagreement; this list wins.
 * FBLA revises events annually — re-verify against the current-year list when updating.
 *
 * On the official list but with no PDF/slug in this catalog (add here if their PDFs
 * ever arrive): american-enterprise-project, partnership-with-business-project,
 * client-service.
 */
const PREJUDGED_EVENTS = new Set([
  'community-service-project',
  'local-chapter-annual-business-report',
  'business-ethics',
  'business-plan',
  // NOTE: Coding & Programming is "prejudged", but its pre-submission is the CODE/PROGRAM,
  // not a report/plan/portfolio document — and the materials card only accepts a document.
  // Per Ronit (2026-07-21) it should NOT show the card, so it is intentionally excluded here.
  'digital-video-production',
  'future-business-educator',
  'future-business-leader',
  'job-interview',
]);

export interface CatalogEvent {
  slug: string;
  name: string;
  org: string;
  category: Category;
  /** The stated category, verbatim from the PDF. Kept so a human can audit the mapping. */
  category_source: string;
  source_pdf: string;
  /** Path to the rubric file. null = not parsed yet. */
  rubric: string | null;
  /**
   * 'confirmed'  — a human checked the parse. Only these may grade anyone (plan.md F3).
   * 'unreviewed' — machine-parsed, waiting on a human.
   * null         — no rubric file at all.
   */
  rubric_status: 'confirmed' | 'unreviewed' | null;
  /** Things the parse checker wants a human to look at. */
  rubric_warnings: string[];
  criteria_count: number | null;
  total_points: number | null;
  time_limit_s: number | null;
  /** Whether the event has pre-submission (prejudged) materials — from the PDF's own wording. */
  prejudged: boolean;
}

const dir = 'rubrics';
const pdfs = (await readdir(dir)).filter((f) => f.endsWith('.pdf'));

// The PDFs are gitignored — a clone without them would "regenerate" an EMPTY catalog
// over the committed one (this happened once; the file came back via git). Refuse.
if (pdfs.length === 0) {
  console.error(
    'No guidelines PDFs found in rubrics/ — refusing to overwrite catalog.json with an empty ' +
      'catalog. Run this from the working copy that has the PDFs (they are gitignored).',
  );
  process.exit(1);
}

// Which events have a rubric file, and has a human signed it off?
interface RubricInfo {
  path: string;
  status: 'confirmed' | 'unreviewed';
  warnings: string[];
  criteria: number;
  points: number;
}
const rubricFiles = new Map<string, RubricInfo>();

for (const org of await readdir(dir, { withFileTypes: true })) {
  if (!org.isDirectory() || org.name.startsWith('_')) continue;
  for (const cat of await readdir(`${dir}/${org.name}`, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const f of await readdir(`${dir}/${org.name}/${cat.name}`)) {
      if (!f.endsWith('.rubric.json')) continue;
      const p = `${org.name}/${cat.name}/${f}`;
      const j = JSON.parse(await readFile(`${dir}/${p}`, 'utf8'));
      rubricFiles.set(f.replace('.rubric.json', ''), {
        path: p,
        // A hand-written rubric with no _review block was written by a human, so it counts
        // as confirmed. Anything the parser produced starts as 'unreviewed'.
        status: j._review?.status === 'unreviewed' ? 'unreviewed' : 'confirmed',
        warnings: j._review?.warnings ?? [],
        criteria: j.criteria?.length ?? 0,
        points: (j.criteria ?? []).reduce(
          (a: number, c: { max_points?: number }) => a + (c.max_points ?? 0),
          0,
        ),
      });
    }
  }
}

const events: CatalogEvent[] = [];

for (const pdf of pdfs) {
  const slug = pdf.replace(/\.pdf$/, '').toLowerCase();
  const buf = await readFile(`${dir}/${pdf}`);
  const text = (await new PDFParse({ data: new Uint8Array(buf) }).getText()).text.replace(/\s+/g, ' ');

  const m = /Event Category:?\s+([A-Za-z ]{3,30}?)\s+Event Elements/i.exec(text);
  const raw = m?.[1]?.trim() ?? '';
  const category = toCategory(raw);

  // Time limit, if the sheet states one. Never invented — null when absent.
  const t = /(\d+)\s*minutes?\s+(?:to\s+)?present/i.exec(text) ?? /presentation.{0,40}?(\d+)\s*minutes/i.exec(text);
  const time_limit_s = t ? Number(t[1]) * 60 : null;

  // Pre-submission materials: the human-supplied official list decides (D-022). The
  // PDF's own wording is used only as a cross-check — a disagreement is flagged for a
  // human, never silently resolved either way.
  const prejudged = PREJUDGED_EVENTS.has(slug);
  if (/pre-?judged/i.test(text) !== prejudged) {
    console.warn(
      `⚠️  ${slug}: the PDF's wording ${prejudged ? 'does NOT mention' : 'mentions'} "prejudged" ` +
        `but the official list says ${prejudged ? 'it IS' : "it ISN'T"} — check the current-year guidelines.`,
    );
  }

  const info = rubricFiles.get(slug);

  events.push({
    slug,
    name: titleCase(pdf.replace(/\.pdf$/, '')),
    org: 'fbla',
    category,
    category_source: raw || '(not stated in the PDF)',
    source_pdf: pdf,
    rubric: info?.path ?? null,
    rubric_status: info?.status ?? null,
    rubric_warnings: info?.warnings ?? [],
    criteria_count: info?.criteria ?? null,
    total_points: info?.points ?? null,
    time_limit_s,
    prejudged,
  });
}

events.sort((a, b) => a.name.localeCompare(b.name));

const byCat = (c: Category) => events.filter((e) => e.category === c).length;
const confirmed = events.filter((e) => e.rubric_status === 'confirmed').length;
const unreviewed = events.filter((e) => e.rubric_status === 'unreviewed').length;

console.log(`presentation ${byCat('presentation')} · roleplay ${byCat('roleplay')} · chapter ${byCat('chapter')} · unclassified ${byCat('unclassified')}`);
console.log(`rubrics: ${confirmed} confirmed · ${unreviewed} awaiting review · ${events.length - confirmed - unreviewed} not parsed`);
console.log(`prejudged (per the PDFs' own wording): ${events.filter((e) => e.prejudged).length} of ${events.length}`);

const unclassified = events.filter((e) => e.category === 'unclassified');
if (unclassified.length) {
  console.log('\n⚠️  no category stated in the PDF — a human must classify these:');
  for (const e of unclassified) console.log(`   ${e.name}`);
}

await writeFile(`${dir}/catalog.json`, JSON.stringify({ generated_at: new Date().toISOString(), events }, null, 2));
console.log(`\nwrote ${dir}/catalog.json`);
