/**
 * The full-report PDF (D-020) — everything the report screen shows, as one file the
 * student can keep, print, or hand to an adviser: score, tier, time plan, next-run
 * plan, every criterion's feedback with its verbatim evidence, the judge's Q&A, the
 * transcript, and the honesty notes.
 *
 * SERVER ONLY (imported by /api/export). Pure function of its input — no network,
 * no keys — so it's unit-testable and deterministic.
 *
 * pdf-lib over a headless browser on purpose: the deployment target can't run a
 * browser (same constraint that shaped /api/presubmission), and pdf-lib is pure JS
 * with the standard fonts built in. Standard fonts are WinAnsi-encoded, so text is
 * sanitized to Latin-1 (typographic characters mapped, anything else replaced) —
 * a visible '?' beats a crashed export.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from 'pdf-lib';
import type {
  GradingResultJSON,
  QAJSON,
  RubricJSON,
  TranscriptJSON,
} from '@/lib/ai/schemas';

// ── palette (the Score Sheet design system, D-017, in print form)
const INK = rgb(0.1, 0.1, 0.1);
const SLATE = rgb(0.42, 0.42, 0.42);
const PEN = rgb(0.12, 0.23, 0.7); // ballpoint blue
const MARK = rgb(0.7, 0.15, 0.12); // judge's red — "no evidence", never "you did badly"
const SHEET = rgb(0.93, 0.906, 0.82); // goldenrod: only on what was actually scored
const RULE = rgb(0.85, 0.82, 0.75);

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_SPACE = 46;

export interface ExportRun {
  run_id: string;
  model_version: string;
  prompt_version: string;
  rubric: RubricJSON;
  result: GradingResultJSON;
  qa: QAJSON;
  transcript: TranscriptJSON;
  metrics: {
    duration_s: number;
    words_per_minute: number;
    filler_count: number;
    fillers_per_minute: number;
    longest_pause_s: number;
  };
  validation: {
    hallucinated_quotes_stripped: number;
    not_assessable_points: number;
    timestamps_realigned?: number;
    time_cuts_stripped?: number;
  };
  cost_cents: number;
}

export interface ExportInput {
  event: { name: string; org: string };
  run: ExportRun;
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** WinAnsi-safe text: map common typographic chars, replace the rest visibly. */
function sanitize(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/…/g, '...')
    .replace(/[→➔➡]/g, '->')
    .replace(/[•●·]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/[^\x20-\x7E\xA1-\xFF\n]/g, '?');
}

/** Greedy word-wrap with hard breaks for pathological single words. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const w of words) {
      const candidate = line === '' ? w : `${line} ${w}`;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line !== '') out.push(line);
      if (font.widthOfTextAtSize(w, size) > width) {
        let chunk = '';
        for (const ch of w) {
          if (font.widthOfTextAtSize(chunk + ch, size) <= width) chunk += ch;
          else {
            out.push(chunk);
            chunk = ch;
          }
        }
        line = chunk;
      } else {
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

interface TextOpts {
  font?: PDFFont;
  size?: number;
  color?: RGB;
  indent?: number;
  gap?: number;
  lineHeight?: number;
}

/** A tiny top-down layout engine: a y-cursor with automatic page breaks. */
class Layout {
  page!: PDFPage;
  y = 0;

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: { reg: PDFFont; bold: PDFFont; italic: PDFFont; mono: PDFFont },
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER_SPACE) this.newPage();
  }

  spacer(h: number) {
    this.y -= h;
  }

  text(raw: string, opts: TextOpts = {}) {
    const font = opts.font ?? this.fonts.reg;
    const size = opts.size ?? 10.5;
    const color = opts.color ?? INK;
    const indent = opts.indent ?? 0;
    const lh = opts.lineHeight ?? size * 1.35;
    const width = CONTENT_W - indent;
    for (const line of wrap(sanitize(raw), font, size, width)) {
      this.ensure(lh);
      this.y -= lh;
      if (line !== '') this.page.drawText(line, { x: MARGIN + indent, y: this.y, size, font, color });
    }
    this.y -= opts.gap ?? 2;
  }

  label(raw: string) {
    this.spacer(6);
    this.text(raw.toUpperCase(), { font: this.fonts.bold, size: 8.5, color: PEN, gap: 3 });
  }

  hr() {
    this.ensure(14);
    this.y -= 8;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + CONTENT_W, y: this.y },
      thickness: 0.75,
      color: RULE,
    });
    this.y -= 6;
  }

  bar(pct: number) {
    const h = 7;
    this.ensure(h + 6);
    this.y -= h + 4;
    this.page.drawRectangle({
      x: MARGIN, y: this.y, width: CONTENT_W, height: h,
      borderColor: INK, borderWidth: 0.75,
    });
    const fill = Math.max(0, Math.min(CONTENT_W, (pct / 100) * CONTENT_W));
    if (fill > 0) {
      this.page.drawRectangle({ x: MARGIN, y: this.y, width: fill, height: h, color: PEN });
    }
    this.y -= 2;
  }
}

const TIER_LABEL: Record<string, string> = {
  needs_work: 'Needs work',
  competitive_regional: 'Regional-ready',
  competitive_state: 'State-ready',
  competitive_national: 'Nationals-ready',
};

const DISCLAIMER =
  'AI practice feedback - not official judging. Rubrix is an independent student-built practice ' +
  'tool and is not affiliated with, sponsored by, or endorsed by FBLA, DECA, TSA, HOSA, or FPSPI. ' +
  'AI practice scores are estimates for preparation only and do not predict official results.';

export async function renderReportPdf(input: ExportInput): Promise<Uint8Array> {
  const { event, run } = input;
  const r = run.result;

  const doc = await PDFDocument.create();
  doc.setTitle(`Rubrix practice score sheet - ${sanitize(event.name)}`);
  doc.setProducer('Rubrix');
  const fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const L = new Layout(doc, fonts);

  // ── header band (goldenrod — this page IS the scored sheet)
  L.page.drawRectangle({ x: 0, y: PAGE_H - 118, width: PAGE_W, height: 118, color: SHEET });
  L.text('RUBRIX - PRACTICE SCORE SHEET', { font: fonts.bold, size: 9, color: PEN, gap: 4 });
  L.text(event.name, { font: fonts.bold, size: 22, gap: 3 });
  L.text(
    `${event.org.toUpperCase()} - graded ${new Date().toISOString().slice(0, 10)} - run ${run.run_id}`,
    { font: fonts.mono, size: 8.5, color: SLATE, gap: 10 },
  );

  // ── score
  const possible = r.assessable_possible ?? r.total_possible;
  const pct = possible > 0 ? (r.total_score / possible) * 100 : 0;
  L.text(`${r.total_score} / ${possible}   -   ${pct.toFixed(1)}%   -   ${TIER_LABEL[r.tier] ?? r.tier}`, {
    font: fonts.bold,
    size: 17,
    gap: 2,
  });
  L.bar(pct);
  if (run.validation.not_assessable_points > 0) {
    L.text(
      `Of the rubric's ${r.total_possible} points, ${run.validation.not_assessable_points} were not judged - ` +
        `your submission didn't contain the evidence for them. You have NOT been marked down for those; ` +
        `they are left out of the score above.`,
      { size: 9.5, color: SLATE },
    );
  }
  L.text(
    `${mmss(run.metrics.duration_s)} long - ${run.metrics.words_per_minute} wpm - ` +
      `${run.metrics.filler_count} fillers (${run.metrics.fillers_per_minute}/min) - ` +
      `longest pause ${run.metrics.longest_pause_s}s` +
      (r.timing ? ` - ${r.timing.over ? 'OVER' : 'within'} the ${mmss(r.timing.limit_s)} limit` : ''),
    { font: fonts.mono, size: 8.5, color: SLATE },
  );
  if (r.timing) L.text(r.timing.note, { size: 9.5, color: r.timing.over ? MARK : SLATE });

  // ── judge's note
  L.hr();
  L.label("The judge's note");
  L.text(r.summary, { size: 11 });

  // ── time plan
  if (r.time_coaching) {
    const tc = r.time_coaching;
    L.hr();
    L.label(
      `Time plan - ${tc.verdict === 'over' ? 'over time' : tc.verdict === 'under' ? 'room to add' : 'fits the limit'}`,
    );
    L.text(tc.note, { size: 10.5 });
    if (tc.cuts.length > 0) {
      L.text('Cut these first:', { font: fonts.bold, size: 10, gap: 3 });
      for (const cut of tc.cuts) {
        L.text(
          `"${cut.quote}"` + (cut.seconds_saved !== undefined ? `  (~${cut.seconds_saved}s back)` : ''),
          { font: fonts.italic, size: 10, indent: 14, gap: 1 },
        );
        L.text(cut.reason, { size: 9.5, color: SLATE, indent: 14, gap: 5 });
      }
      const total = tc.cuts.reduce((a, c) => a + (c.seconds_saved ?? 0), 0);
      if (total > 0) {
        L.text(`Cutting all of these buys back ~${Math.round(total)}s at your measured pace.`, {
          font: fonts.mono, size: 8.5, color: SLATE,
        });
      }
    }
    if (tc.additions.length > 0) {
      L.text('Worth adding:', { font: fonts.bold, size: 10, gap: 3 });
      for (const add of tc.additions) {
        const target = add.targets_criterion_id
          ? ` (strengthens: ${nameOf(run.rubric, add.targets_criterion_id)})`
          : '';
        L.text(`+ ${add.suggestion}${target}`, { size: 10, indent: 14, gap: 3 });
      }
    }
  }

  // ── next run plan
  if (r.next_run_plan?.length) {
    L.hr();
    L.label('Your next run');
    r.next_run_plan.forEach((step, i) => L.text(`${i + 1}. ${step}`, { size: 10.5, indent: 4, gap: 3 }));
  }

  // ── top priorities + fastest points
  L.hr();
  L.label('Top priorities');
  r.top_priorities.forEach((p) => L.text(`- ${p}`, { size: 10.5, indent: 4, gap: 3 }));
  if (r.point_gaps_ranked.length > 0) {
    L.label('Fastest points');
    for (const g of r.point_gaps_ranked.slice(0, 3)) {
      const crit = r.criteria.find((c) => c.criterion_id === g.criterion_id);
      L.text(`+${g.points_available} pts - ${nameOf(run.rubric, g.criterion_id)} (${g.difficulty})`, {
        font: fonts.bold, size: 10, indent: 4, gap: 1,
      });
      if (crit?.improvements[0]) L.text(crit.improvements[0], { size: 9.5, color: SLATE, indent: 18, gap: 4 });
    }
  }

  // ── rubric feedback, line by line
  L.hr();
  L.label('Rubric feedback - line by line');
  r.criteria.forEach((c, i) => {
    L.spacer(4);
    const name = nameOf(run.rubric, c.criterion_id);
    L.text(
      `${String(i + 1).padStart(2, '0')}  ${name}   -   ${c.assessable ? c.score : '-'} / ${c.max_points}` +
        (c.assessable && c.confidence !== 'high' ? `   (confidence: ${c.confidence})` : ''),
      { font: fonts.bold, size: 11, gap: 2 },
    );
    if (!c.assessable) {
      L.text(
        `Not judged - ${c.not_assessable_reason ?? 'not evidenced by this submission.'}`,
        { size: 9.5, color: MARK, indent: 14, gap: 4 },
      );
      return;
    }
    for (const e of c.evidence) {
      const ts = e.source === 'transcript' && e.timestamp_start !== undefined ? `[${mmss(e.timestamp_start)}] ` : '';
      const body = e.source === 'visual' ? `Seen - ${e.quote}` : `"${e.quote}"`;
      L.text(`${ts}${body}`, { font: fonts.italic, size: 9.5, indent: 14, gap: 2 });
    }
    if (c.what_worked && c.what_worked !== 'Not assessable.') {
      L.text(`What worked: ${c.what_worked}`, { size: 9.5, indent: 14, gap: 2 });
    }
    L.text(c.justification, { size: 9.5, color: SLATE, indent: 14, gap: 2 });
    if (c.to_full_marks && c.to_full_marks !== 'Not assessable.') {
      L.text('Path to full marks:', { font: fonts.bold, size: 9, color: PEN, indent: 14, gap: 1 });
      L.text(c.to_full_marks, { size: 9.5, indent: 22, gap: 2 });
    }
    c.improvements.forEach((im) => L.text(`-> ${im}`, { size: 9.5, indent: 22, gap: 1 }));
    if (c.sample_lines && c.sample_lines.length > 0) {
      L.text('Try saying:', { font: fonts.bold, size: 9, indent: 14, gap: 1 });
      c.sample_lines.forEach((line) =>
        L.text(`"${line}"`, { font: fonts.italic, size: 9, color: PEN, indent: 22, gap: 1 }),
      );
    }
    L.spacer(3);
  });

  // ── judge Q&A
  L.hr();
  L.label(`Judge Q&A - ${run.qa.questions.length} questions to drill`);
  run.qa.questions.forEach((q, i) => {
    L.text(`Q${i + 1} (${q.difficulty}): ${q.question}`, { font: fonts.bold, size: 10, gap: 1 });
    L.text(`Why a judge asks: ${q.targets}`, { size: 9, color: SLATE, indent: 14, gap: 1 });
    q.answer_points.forEach((p) => L.text(`- ${p}`, { size: 9, indent: 22, gap: 1 }));
    L.spacer(4);
  });

  // ── transcript
  L.hr();
  L.label('Transcript');
  for (const s of run.transcript.segments) {
    L.text(`[${mmss(s.start)}] ${s.text}`, { size: 9, gap: 1.5 });
  }

  // ── honesty notes
  L.hr();
  L.label('Honesty notes');
  const v = run.validation;
  L.text(
    `Model ${run.model_version} - prompt ${run.prompt_version} - cost ${run.cost_cents.toFixed(1)} cents. ` +
      `${v.hallucinated_quotes_stripped} unsupported quote(s) stripped by verification` +
      (v.timestamps_realigned ? `; ${v.timestamps_realigned} timestamp(s) corrected in code` : '') +
      (v.time_cuts_stripped ? `; ${v.time_cuts_stripped} unverifiable cut suggestion(s) discarded` : '') +
      `. Every quote above was verified against your actual submission; scores, totals, tiers, and ` +
      `times-saved are computed in code, not taken from the model.`,
    { size: 8.5, color: SLATE },
  );

  // ── footers (after all pages exist)
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const lines = wrap(sanitize(DISCLAIMER), fonts.reg, 7, CONTENT_W - 60);
    let fy = 30;
    for (const line of [...lines].reverse()) {
      p.drawText(line, { x: MARGIN, y: fy, size: 7, font: fonts.reg, color: SLATE });
      fy += 9;
    }
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: PAGE_W - MARGIN - 52, y: 30, size: 7, font: fonts.mono, color: SLATE,
    });
  });

  return doc.save();
}

function nameOf(rubric: RubricJSON, id: string): string {
  return rubric.criteria.find((c) => c.id === id)?.name ?? id;
}
