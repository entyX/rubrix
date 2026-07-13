/**
 * F3 / milestone M6 — parse every official rating sheet into structured RubricJSON.
 *
 * plan.md §9.4, prompt r-1.0.0, verbatim. The PDF goes to the model INTACT (not as
 * flattened text) because a rating sheet is a table, and a PDF text extractor turns a
 * table into soup.
 *
 * ⚠️  A parse is NOT a rubric. plan.md F3: "never grade on an unreviewed parse."
 * Every file written here is marked `"status": "unreviewed"` and the app REFUSES to
 * grade against it until a human confirms it in the review screen. The automated
 * checks below (arithmetic, criterion count, NOT_A_RUBRIC) decide what a human needs
 * to look at hardest — they do not replace the human.
 *
 * Run:  npm run parse-rubrics          (all events missing a rubric)
 *       npm run parse-rubrics -- --all (re-parse everything, overwriting UNREVIEWED only)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { generate, MAX_OUTPUT_TOKENS, THINKING_BUDGET } from '@/lib/ai/gemini';
import { RUBRIC_PARSE_SYSTEM, PROMPT_VERSION_RUBRIC } from '@/lib/ai/prompts';
import { RubricJSON, RUBRIC_RESPONSE_SCHEMA } from '@/lib/ai/schemas';
import { stripFences } from '@/lib/ai/json';

interface CatalogEvent {
  slug: string;
  name: string;
  org: string;
  category: string;
  source_pdf: string;
  rubric: string | null;
}

const all = process.argv.includes('--all');
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

const catalog = JSON.parse(await readFile('rubrics/catalog.json', 'utf8')) as {
  events: CatalogEvent[];
};

let targets = catalog.events;
if (only) targets = targets.filter((e) => e.slug === only);
else if (!all) targets = targets.filter((e) => e.rubric === null);

console.log(`parsing ${targets.length} rating sheet(s) with ${PROMPT_VERSION_RUBRIC}\n`);

let ok = 0;
let flagged = 0;
let failed = 0;
let cost = 0;

for (const e of targets) {
  const dest = `rubrics/${e.org}/${e.category}/${e.slug}.rubric.json`;

  // Never clobber human work. Only a file this script itself produced — i.e. one still
  // marked 'unreviewed' — may be overwritten. A hand-written rubric has no `_review`
  // block at all, and an absent block must NOT be read as "fair game".
  if (existsSync(dest)) {
    const cur = JSON.parse(await readFile(dest, 'utf8'));
    if (cur?._review?.status !== 'unreviewed') {
      console.log(`⏭  ${e.name} — human-owned rubric, leaving it alone`);
      continue;
    }
  }

  const runId = randomUUID().slice(0, 8);
  try {
    const pdf = await readFile(`rubrics/${e.source_pdf}`);

    const res = await generate({
      system: RUBRIC_PARSE_SYSTEM,
      user:
        `This is the official ${e.org.toUpperCase()} guidelines document for "${e.name}". ` +
        `Find the RATING SHEET (the scored grid) and extract every scored line item from it. ` +
        `Ignore the prose sections, eligibility rules, and the objective-test description — ` +
        `only the scored rating-sheet rows are criteria.`,
      responseSchema: RUBRIC_RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS.rubricParse,
      temperature: 0.2, // plan.md §9.4
      seed: 7,
      thinkingBudget: THINKING_BUDGET.standard,
      document: { base64: pdf.toString('base64'), mimeType: 'application/pdf' },
      promptVersion: PROMPT_VERSION_RUBRIC,
      runId,
      label: `parse:${e.slug}`,
    });
    cost += res.costCents;

    // ── sanitise before validating.
    const warnings: string[] = [];
    const raw = JSON.parse(stripFences(res.text)) as {
      title?: string;
      total_points?: number;
      criteria?: Array<{ id?: string; name?: string; max_points?: number }>;
    };

    if (Array.isArray(raw.criteria)) {
      // §9.4: "Non-scored guidance (instructions, tie-breakers) goes in notes, not criteria."
      // Rating sheets carry rows worth 0 (protocol checkboxes, staff-only penalty lines).
      // They are not scoreable criteria and RubricJSON rightly rejects them, so drop them
      // rather than fail the whole sheet — but say which ones went.
      const dropped = raw.criteria.filter((c) => !(Number(c.max_points) > 0));
      if (dropped.length) {
        warnings.push(
          `Dropped ${dropped.length} non-scored row(s) worth 0 points (${dropped
            .map((c) => c.name ?? c.id)
            .join(', ')}). Check they really aren't scored.`,
        );
        raw.criteria = raw.criteria.filter((c) => Number(c.max_points) > 0);
      }

      // Force ids to the ^[a-z0-9_]+$ shape and de-duplicate.
      const seen = new Set<string>();
      for (const c of raw.criteria) {
        let id = String(c.id ?? c.name ?? 'criterion')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 40);
        if (id === '') id = 'criterion';
        let n = 2;
        const base = id;
        while (seen.has(id)) id = `${base}_${n++}`;
        seen.add(id);
        c.id = id;
      }
    }

    const parsed = RubricJSON.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      console.log(`❌ ${e.name} — invalid: ${issues.slice(0, 100)}`);
      failed++;
      continue;
    }
    const rubric = parsed.data;

    // ── automated checks. These decide what a human scrutinises, not whether to trust it.
    const sum = rubric.criteria.reduce((a, c) => a + c.max_points, 0);

    if (rubric.title === 'NOT_A_RUBRIC' || rubric.criteria.length === 0) {
      console.log(`❌ ${e.name} — no rating sheet found in the PDF`);
      failed++;
      continue;
    }
    if (Math.abs(sum - rubric.total_points) > 0.01) {
      warnings.push(
        `Point totals disagree: the criteria add up to ${sum}, but the sheet states ${rubric.total_points}. One of them is wrong — check which.`,
      );
    }
    if (rubric.criteria.length > 25) {
      warnings.push(`${rubric.criteria.length} criteria is unusually many — check for duplicates.`);
    }
    const ids = rubric.criteria.map((c) => c.id);
    if (new Set(ids).size !== ids.length) warnings.push('Duplicate criterion ids.');

    await mkdir(`rubrics/${e.org}/${e.category}`, { recursive: true });
    await writeFile(
      dest,
      JSON.stringify(
        {
          _review: {
            status: 'unreviewed',
            warnings,
            parsed_at: new Date().toISOString(),
            prompt_version: PROMPT_VERSION_RUBRIC,
            source_pdf: e.source_pdf,
            note: 'Machine-parsed from the official rating sheet. plan.md F3: nobody may be graded against this until a human confirms it.',
          },
          ...rubric,
        },
        null,
        2,
      ),
      'utf8',
    );

    if (warnings.length) {
      console.log(`⚠️  ${e.name} — ${rubric.criteria.length} criteria, ${sum} pts · ${warnings[0]}`);
      flagged++;
    } else {
      console.log(`✅ ${e.name} — ${rubric.criteria.length} criteria, ${sum} pts`);
      ok++;
    }
  } catch (err) {
    console.log(`❌ ${e.name} — ${(err as Error).message.split('\n')[0].slice(0, 90)}`);
    failed++;
  }
}

console.log(
  `\nclean ${ok} · needs a closer look ${flagged} · failed ${failed} · cost ${(cost / 100).toFixed(2)} USD`,
);
console.log('\nAll of these are UNREVIEWED. Confirm each one in the app before it can grade anyone.');
console.log('Run `npm run catalog` to refresh the sidebar.');
