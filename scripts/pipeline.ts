/**
 * The judge, end to end, with no product UI in the way (plan.md §23 "prove the magic first").
 *
 *   website  -> crawl + screenshots + site facts ─┐
 *                                                 ├─> graded JSON -> judge Q&A
 *   audio    -> transcript + delivery metrics ────┘
 *
 * Either half, or both. §3 `prejudged_plus_presentation` takes "PDF or link, AND/OR video".
 *
 * Usage:
 *   npm run judge -- --site <url-or-folder> [--audio <file>] --rubric <path> [options]
 *   npm run judge -- --audio <file> --rubric <path> [options]
 *
 *   --site   <url|dir>  live URL, or a local folder of source files
 *   --audio  <file>     presentation recording (mp3/m4a/wav). AUDIO ONLY — never video.
 *   --frames <dir>      still frames (jpg/png) sampled from the run. With an
 *                       OPENROUTER_API_KEY set they become a whole-run visual report
 *                       (D-018); without one they attach to the judge raw.
 *   --rubric <path>     rubric JSON
 *   --event  <name>     event name        (default: "Website Coding & Development")
 *   --org    <slug>     fbla|deca|tsa|hosa (default: fbla)
 *   --limit  <sec>      official time limit for the spoken presentation
 *   --team   <n>        team size         (default: 1)
 *   --pages  <n>        max pages to crawl (default: 4)
 *   --no-qa             skip the Q&A pass
 *
 * Extract audio locally first — the video must never leave the device (CLAUDE.md):
 *   ffmpeg -i run.mp4 -vn -ac 1 -ar 16000 -b:a 64k run.mp3
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { transcribeAudioFile } from '@/lib/ai/transcribe';
import { computeDeliveryMetrics } from '@/lib/metrics/delivery';
import { captureSite } from '@/lib/site/crawl';
import { computeSiteMetrics } from '@/lib/site/metrics';
import { gradeSubmission, type Submission } from '@/lib/ai/grade';
import { generateQA } from '@/lib/ai/qa';
import { buildVisualReport } from '@/lib/ai/visual';
import { hasOpenRouter } from '@/lib/ai/openrouter';
import { RubricJSON } from '@/lib/ai/schemas';
import { mmss } from '@/lib/transcript/format';
import { addUsage, ZERO_USAGE, COST_TARGET_CENTS, GEMINI_MODEL } from '@/lib/ai/models';

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (flag: string) => process.argv.includes(flag);

const bar = (pct: number, width = 20) => {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
};

async function main() {
  const site = arg('--site');
  const audio = arg('--audio');

  if (!site && !audio) {
    console.error(
      'Nothing to grade.\n\n' +
        '  npm run judge -- --site <url-or-folder> --rubric <path>\n' +
        '  npm run judge -- --site ./my-site --audio run.mp3 --rubric <path>\n',
    );
    process.exitCode = 1;
    return;
  }

  const rubricPath = arg('--rubric', 'rubrics/fbla/presentation/website-coding-and-development.rubric.json')!;
  const eventName = arg('--event', 'Website Coding & Development')!;
  const org = arg('--org', 'fbla')!;
  const limitRaw = arg('--limit');
  const timeLimitS = limitRaw ? Number(limitRaw) : null;
  const teamSize = Number(arg('--team', '1'));
  const maxPages = Number(arg('--pages', '4'));
  const runId = randomUUID().slice(0, 8);

  const rubricParsed = RubricJSON.safeParse(JSON.parse(await readFile(rubricPath, 'utf8')));
  if (!rubricParsed.success) {
    console.error(`Rubric ${rubricPath} is not valid RubricJSON:`);
    for (const i of rubricParsed.error.issues) console.error(`  ${i.path.join('.')}: ${i.message}`);
    process.exitCode = 1;
    return;
  }
  const rubric = rubricParsed.data;

  if (rubricPath.includes('_dev-')) {
    console.warn('\n⚠️  DEV PLACEHOLDER rubric — invented, not FBLA\'s. Scores are meaningless.\n');
  }

  console.log(`run ${runId} · ${GEMINI_MODEL} · ${org.toUpperCase()} ${eventName}`);
  console.log(`rubric: ${rubric.title} (${rubric.criteria.length} criteria, ${rubric.total_points} pts)\n`);

  const t0 = Date.now();
  let usage = ZERO_USAGE;
  // Real money spent, summed from each call's own accounting. Not derivable from
  // `usage` alone any more: Whisper bills per audio hour and OpenRouter reports its
  // own charge (D-018), neither of which are Gemini tokens.
  let cents = 0;
  const submission: Submission = {};

  // ── Website
  if (site) {
    console.log(`Opening the site…  ${site}`);
    const capture = await captureSite(site, { maxPages });
    const m = computeSiteMetrics(capture);
    submission.site = { capture, metrics: m };

    const shots = capture.pages.reduce((a, p) => a + p.shots.length, 0);
    console.log(
      `   ${m.pages_crawled} page(s) · ${shots} screenshots · ` +
        `${m.external_stylesheets} css + ${m.external_scripts} js file(s) · ` +
        `${m.console_errors} console error(s)`,
    );
    console.log(
      `   code separated: ${m.languages_separated ? 'yes' : 'NO'} · ` +
        `alt text: ${m.alt_text_coverage_pct}% of ${m.images_total} image(s) · ` +
        `nav consistent: ${m.consistent_nav_across_pages ? 'yes' : 'no'}`,
    );
    for (const n of m.notes) console.log(`   ⚠️  ${n}`);
    console.log();
  }

  // ── Presentation
  if (audio) {
    console.log('Transcribing your run…');
    const tr = await transcribeAudioFile(audio, runId);
    usage = addUsage(usage, tr.usage);
    cents += tr.costCents;
    for (const w of tr.timestampWarnings) console.warn(`   ⚠️  ${w}`);
    const metrics = computeDeliveryMetrics(tr.transcript, tr.durationS, timeLimitS);
    submission.presentation = { transcript: tr.transcript, metrics };
    console.log(
      `   ${mmss(metrics.duration_s)} · ${metrics.word_count} words · ${metrics.words_per_minute} wpm · ` +
        `${metrics.filler_count} fillers (${metrics.fillers_per_minute}/min)\n`,
    );
  }

  // ── Video frames (opt-in "eyes", DECISIONS D-015/D-018). --frames <dir> of jpg/png stills.
  const framesDir = arg('--frames');
  if (framesDir) {
    const { readdir, readFile: rf } = await import('node:fs/promises');
    const files = (await readdir(framesDir))
      .filter((f) => /\.(jpe?g|png)$/i.test(f))
      .sort();
    const frames = [];
    for (let i = 0; i < files.length; i++) {
      const b = await rf(`${framesDir}/${files[i]}`);
      frames.push({
        base64: b.toString('base64'),
        mimeType: files[i].toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
        atSeconds: submission.presentation
          ? (submission.presentation.metrics.duration_s * (i + 0.5)) / files.length
          : i,
      });
    }
    if (frames.length > 0 && hasOpenRouter()) {
      // D-018: the open-source vision model watches the frames and writes the report;
      // the judge grades from the report and its quotes are grounded against it.
      console.log('Watching your run…');
      const analysis = await buildVisualReport({
        frames,
        durationS: submission.presentation?.metrics.duration_s ?? null,
        runId,
      });
      cents += analysis.costCents;
      submission.visual = { report: analysis.report, frameCount: frames.length };
      console.log(
        `   visual report from ${frames.length} frame(s) — ` +
          `${analysis.report.observations.length} observation(s)` +
          (analysis.retryUsed ? ' (schema retry used)' : '') +
          '\n',
      );
    } else if (frames.length > 0) {
      submission.frames = frames;
      console.log(
        `   ${frames.length} video frame(s) attached raw — set OPENROUTER_API_KEY for the whole-run visual report.\n`,
      );
    }
  }

  // ── Grade
  console.log('Judging against the rubric…');
  const graded = await gradeSubmission({
    rubric,
    submission,
    event: { org, eventName, timeLimitS, teamSize, scoreAnchors: '' },
    runId,
  });
  usage = addUsage(usage, graded.usage);
  cents += graded.costCents;

  // ── Q&A
  let qa = null;
  if (!has('--no-qa')) {
    console.log('Writing your Q&A grill…');
    qa = await generateQA({
      grading: graded.result,
      qaFormatDescription:
        'Judges question the competitor after the presentation; questions probe implementation decisions, coding choices, and understanding of the topic. All team members may respond.',
      runId,
    });
    usage = addUsage(usage, qa.usage);
    cents += qa.costCents;
  }

  const elapsedS = (Date.now() - t0) / 1000;
  const total = cents;
  const r = graded.result;
  const v = graded.report;

  const possible = r.assessable_possible ?? r.total_possible;
  const pct = possible > 0 ? (r.total_score / possible) * 100 : 0;

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  ${r.total_score} / ${possible}   ${pct.toFixed(1)}%   ${r.tier.toUpperCase()}`);
  if (v.not_assessable_points > 0) {
    console.log(
      `  (of the sheet's ${r.total_possible} points, ${v.not_assessable_points} could not be judged from what you submitted)`,
    );
  }
  console.log(`${'─'.repeat(64)}\n`);

  for (const c of r.criteria) {
    const def = rubric.criteria.find((x) => x.id === c.criterion_id);
    const name = def?.name ?? c.criterion_id;
    if (!c.assessable) {
      console.log(`${'·'.repeat(20)}     —/${c.max_points}  ${name}`);
      console.log(`     not judged: ${c.not_assessable_reason ?? 'not evidenced by this submission'}`);
      continue;
    }
    const cpct = c.max_points > 0 ? (c.score / c.max_points) * 100 : 0;
    const flag = c.confidence === 'high' ? '' : `  [${c.confidence} confidence]`;
    console.log(`${bar(cpct)}  ${String(c.score).padStart(3)}/${c.max_points}  ${name}${flag}`);
    for (const e of c.evidence.slice(0, 1)) {
      // A timestamp only means something for a quote taken from the recording. Showing
      // "[0:00]" next to a line of CSS is nonsense dressed up as precision.
      const ts =
        e.source === 'transcript' && e.timestamp_start !== undefined
          ? `[${mmss(e.timestamp_start)}] `
          : '';
      const q = e.quote.replace(/\s+/g, ' ').slice(0, 68);
      console.log(`     ${ts}"${q}${e.quote.length > 68 ? '…' : ''}"`);
    }
  }

  console.log(`\nSUMMARY\n  ${r.summary.replace(/\n/g, '\n  ')}`);

  console.log('\nFASTEST POINTS');
  for (const g of r.point_gaps_ranked.slice(0, 3)) {
    const def = rubric.criteria.find((x) => x.id === g.criterion_id);
    const crit = r.criteria.find((x) => x.criterion_id === g.criterion_id);
    console.log(`  +${g.points_available} pts · ${def?.name ?? g.criterion_id} (${g.difficulty})`);
    if (crit?.improvements[0]) console.log(`     → ${crit.improvements[0]}`);
  }

  if (r.timing) console.log(`\nTIMING\n  ${r.timing.note}`);

  if (qa) {
    console.log(`\nJUDGE Q&A (${qa.qa.questions.length} questions)`);
    for (const q of qa.qa.questions.slice(0, 3)) console.log(`  [${q.difficulty}] ${q.question}`);
    console.log(`  …and ${Math.max(0, qa.qa.questions.length - 3)} more in the JSON.`);
  }

  console.log('\nPOST-VALIDATION (plan.md §9.7)');
  console.log(`  hallucinated quotes stripped : ${v.hallucinated_quotes_stripped}`);
  console.log(`  confidence dropped           : ${v.criteria_with_confidence_dropped.join(', ') || 'none'}`);
  console.log(
    `  arithmetic overwritten       : ${v.arithmetic_overwritten ? `yes (model said ${v.model_total}, real sum ${v.computed_total})` : 'no'}`,
  );
  console.log(`  tier overwritten             : ${v.tier_overwritten ? 'yes' : 'no'}`);
  console.log(`  scores clamped               : ${v.scores_clamped.join(', ') || 'none'}`);
  console.log(`  not assessable               : ${v.not_assessable.join(', ') || 'none'}`);
  console.log(`  retries used                 : schema=${v.schema_retry_used} coverage=${v.coverage_retry_used}`);

  console.log('\nRUN');
  console.log(`  wall clock : ${elapsedS.toFixed(1)}s  ${elapsedS < 240 ? '(under the 4-min gate)' : '(OVER the 4-min gate)'}`);
  console.log(
    `  cost       : ${total.toFixed(2)}¢  ${total <= COST_TARGET_CENTS ? `(within the ${COST_TARGET_CENTS}¢ target)` : `(OVER the ${COST_TARGET_CENTS}¢ target)`}`,
  );
  console.log(
    `  tokens     : in ${usage.inputTextTokens}t + ${usage.inputAudioTokens}a · out ${usage.outputTokens} · thought ${usage.thoughtTokens}`,
  );

  const outDir = path.join('runs', runId);
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, 'run.json'),
    JSON.stringify(
      {
        run_id: runId,
        model_version: GEMINI_MODEL,
        prompt_version: graded.promptVersion,
        event: { org, eventName, timeLimitS, teamSize },
        rubric_title: rubric.title,
        submission: {
          site: site ?? null,
          audio: audio ?? null,
          site_metrics: submission.site?.metrics ?? null,
          delivery_metrics: submission.presentation?.metrics ?? null,
          transcript: submission.presentation?.transcript ?? null,
        },
        result: r,
        qa: qa?.qa ?? null,
        validation: v,
        token_usage: usage,
        cost_cents: Number(total.toFixed(3)),
        elapsed_s: Number(elapsedS.toFixed(1)),
        graded_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\n  saved      : ${path.join(outDir, 'run.json')}\n`);

  console.log(
    'Rubrix is an independent student-built practice tool and is not affiliated with,\n' +
      'sponsored by, or endorsed by FBLA, DECA, TSA, HOSA, or FPSPI. AI practice scores are\n' +
      'estimates for preparation only and do not predict official results.\n',
  );
}

main().catch((err: unknown) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
