/**
 * Bulk-confirm the machine-parsed rubrics (plan.md F3's human sign-off, done at the CLI).
 *
 * This is the human saying "I checked these." It is NOT a rubber stamp: it prints exactly
 * what it is blessing, and calls out the ones where the parse and the official sheet
 * DISAGREE ON THE POINT TOTAL — those are the parses most likely to be wrong, and the ones
 * a human should actually eyeball.
 *
 * Run: npm run confirm-rubrics            (report only — changes nothing)
 *      npm run confirm-rubrics -- --yes   (actually confirm)
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { RubricJSON } from '@/lib/ai/schemas';

const apply = process.argv.includes('--yes');

// readdir({recursive}) rather than fs.glob — glob works at runtime but isn't in @types/node.
const files = (await readdir('rubrics', { recursive: true }))
  .map((f) => `rubrics/${String(f).replace(/\\/g, '/')}`)
  .filter((f) => f.endsWith('.rubric.json') && !f.includes('/_'))
  .sort();

interface Row {
  file: string;
  title: string;
  criteria: number;
  sum: number;
  stated: number;
  mismatch: boolean;
  warnings: string[];
  already: boolean;
}

const rows: Row[] = [];

for (const file of files) {
  const j = JSON.parse(await readFile(file, 'utf8'));
  const p = RubricJSON.safeParse(j);
  if (!p.success) {
    console.log(`❌ ${file} — INVALID, not confirming: ${p.error.issues[0].message}`);
    continue;
  }
  const sum = p.data.criteria.reduce((a, c) => a + c.max_points, 0);
  rows.push({
    file,
    title: p.data.title,
    criteria: p.data.criteria.length,
    sum,
    stated: p.data.total_points,
    mismatch: Math.abs(sum - p.data.total_points) > 0.01,
    warnings: j._review?.warnings ?? [],
    already: j._review?.status !== 'unreviewed',
  });
}

const mismatched = rows.filter((r) => r.mismatch);
const droppedRows = rows.filter((r) => r.warnings.some((w) => w.startsWith('Dropped')));

console.log(`${rows.length} rubric(s) · ${rows.filter((r) => r.already).length} already confirmed\n`);

if (mismatched.length) {
  console.log(`⚠️  ${mismatched.length} where the criteria DON'T add up to the sheet's stated total.`);
  console.log('    These are the ones worth opening the PDF for:\n');
  for (const r of mismatched) {
    console.log(
      `    ${r.title.padEnd(46).slice(0, 46)} criteria sum ${String(r.sum).padStart(4)}  vs sheet ${r.stated}`,
    );
  }
  console.log('');
}

console.log(
  `ℹ️  ${droppedRows.length} had non-scored rows (staff-only penalties, protocol checkboxes) dropped.`,
);
console.log('    §9.4 says those belong in notes, not criteria. Expected, benign.\n');

if (!apply) {
  console.log('Report only. Re-run with --yes to confirm them.');
  process.exit(0);
}

let n = 0;
for (const r of rows) {
  const j = JSON.parse(await readFile(r.file, 'utf8'));

  // Tidy titles. The parse often grabs the PDF's running header
  // ("2025-2026 Competitive Events Guidelines Public Speaking (High School)").
  // Strip it down to the event itself — cosmetic only, no scored content touched.
  if (typeof j.title === 'string') {
    j.title = j.title
      .replace(/^\d{4}-\d{4}\s+(FBLA\s+)?Competitive Events Guidelines\s*[-:]?\s*/i, '')
      .replace(/^\d{4}-\d{4}\s+/, '')
      .replace(/\s+Presentation Rating Sheet$/i, '')
      .replace(/\s+Rating Sheet$/i, '')
      .trim();
  }

  j._review = {
    ...(j._review ?? {}),
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
    confirmed_by: 'ronit (bulk sign-off via scripts/confirm-rubrics.mts)',
  };
  await writeFile(r.file, JSON.stringify(j, null, 2), 'utf8');
  n++;
}

console.log(`✅ confirmed ${n} rubric(s). They can now grade.`);
console.log('   Run `npm run catalog` to refresh the sidebar.');
