'use client';

/**
 * The grade report — the money screen (design brief §6, "the product's best screen").
 *
 * Score → fastest points → tabs (rubric feedback · judge Q&A · transcript).
 * Goldenrod is reserved for what's actually been scored: the header and the rubric-feedback
 * rows (via <EvidenceLine>). Q&A and the transcript aren't scores, so they stay on white
 * cards (DECISIONS D-017). A criterion the submission couldn't evidence says so out loud
 * instead of showing a confident zero, and a low-confidence score is flagged rather than
 * dressed up (§9.7).
 */
import { useState } from 'react';
import { EvidenceLine } from '@/components/EvidenceLine';
import type { GradingResultJSON, QAJSON, RubricJSON, TranscriptJSON } from '@/lib/ai/schemas';
import type { DeliveryMetrics } from '@/lib/metrics/delivery';
import type { CatalogEvent } from '@/lib/rubrics/types';

export interface RunResult {
  run_id: string;
  model_version: string;
  prompt_version: string;
  rubric: RubricJSON;
  result: GradingResultJSON;
  qa: QAJSON;
  validation: { hallucinated_quotes_stripped: number; not_assessable_points: number };
  transcript: TranscriptJSON;
  metrics: DeliveryMetrics;
  /** D-023: which provider served each stage — shown in the footer as usage proof. */
  providers?: { transcribe: string; visual: string; judge: string };
  cost_cents: number;
}

const TIER_LABEL: Record<string, string> = {
  needs_work: 'Needs work',
  competitive_regional: 'Regional-ready',
  competitive_state: 'State-ready',
  competitive_national: 'Nationals-ready',
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Report({
  run,
  event,
  onAgain,
  onAnswerQuestions,
}: {
  run: RunResult;
  event: CatalogEvent;
  onAgain: () => void;
  /** Offered when criteria went unscored for want of a Q&A session. */
  onAnswerQuestions?: () => void;
}) {
  const [tab, setTab] = useState<'rubric' | 'qa' | 'transcript'>('rubric');
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const r = run.result;

  /** D-020: the whole report — scores, feedback, Q&A, transcript — as one PDF file. */
  const exportPdf = async () => {
    setExportError('');
    setExporting(true);
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ run, event: { name: event.name, org: event.org } }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      a.href = url;
      a.download = `rubrix-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("We couldn't build the PDF this time. Try again in a moment.");
    } finally {
      setExporting(false);
    }
  };
  const possible = r.assessable_possible ?? r.total_possible;
  const pct = possible > 0 ? (r.total_score / possible) * 100 : 0;
  const notJudged = run.validation.not_assessable_points;
  const tierLabel = TIER_LABEL[r.tier] ?? r.tier;

  const nameOf = (id: string) => run.rubric.criteria.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-4">
      {/* ── score: the only place besides the criterion rows where goldenrod appears */}
      <header className="sheet p-6 sm:p-8">
        <p className="label">
          {event.org.toUpperCase()} · {event.name}
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
          <span className="mono text-[52px] font-medium leading-[0.9] sm:text-[72px]">
            {r.total_score}
          </span>
          <span className="mono pb-1 text-[24px]" style={{ color: 'var(--slate)' }}>
            / {possible}
          </span>
          <span className="chip chip-active ml-auto">{tierLabel}</span>
        </div>

        <div className="bar mt-5 h-2">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="mono mt-2 text-[13px]">{pct.toFixed(1)}%</p>

        {notJudged > 0 && (
          <div className="mt-5 rounded p-4" style={{ background: 'var(--card)', border: '1px solid var(--rule)' }}>
            <p className="text-[13px] leading-relaxed">
              Of the rubric&rsquo;s {r.total_possible} points, <strong>{notJudged}</strong>{' '}
              weren&rsquo;t judged — your submission didn&rsquo;t contain the evidence for them. You
              have <strong>not</strong>{' '}
              been marked down; they&rsquo;re simply left out of the score above.
            </p>
            {onAnswerQuestions && (
              <>
                <p className="mt-3 text-[13px] leading-relaxed">
                  Some of those need you to answer the judge&rsquo;s questions. Do the drill and they
                  get scored for real.
                </p>
                <button onClick={onAnswerQuestions} className="btn btn-primary mt-3 h-9 px-4 text-[13px]">
                  Answer the judge&rsquo;s questions →
                </button>
              </>
            )}
          </div>
        )}

        <div className="mono mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px]" style={{ color: 'var(--slate)' }}>
          <span>{mmss(run.metrics.duration_s)}</span>
          <span>{run.metrics.words_per_minute} WPM</span>
          <span>{run.metrics.filler_count} FILLERS</span>
          {r.timing && <span style={{ color: r.timing.over ? 'var(--mark)' : undefined }}>{r.timing.over ? 'OVER TIME' : 'WITHIN TIME'}</span>}
        </div>
      </header>

      {/* ── judge's summary */}
      <section className="card p-5 sm:p-6">
        <p className="label mb-2">The judge&rsquo;s note</p>
        <p className="text-[16px] leading-relaxed">{r.summary}</p>
      </section>

      {/* ── time plan (D-020): what to cut when over, what to add when under */}
      {r.time_coaching && (
        <section className="card p-5 sm:p-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="label">Time plan</p>
            <span
              className="chip"
              style={
                r.time_coaching.verdict === 'over'
                  ? { background: 'var(--mark)', color: '#fff', borderColor: 'var(--mark)' }
                  : undefined
              }
            >
              {r.time_coaching.verdict === 'over'
                ? 'Over time'
                : r.time_coaching.verdict === 'under'
                  ? 'Room to add'
                  : 'Fits the limit'}
            </span>
          </div>
          <p className="text-[15px] leading-relaxed">{r.time_coaching.note}</p>

          {r.time_coaching.cuts.length > 0 && (
            <div className="mt-4">
              <p className="label mb-2">Cut these first</p>
              <ul className="flex flex-col gap-3">
                {r.time_coaching.cuts.map((cut, i) => (
                  <li key={i} className="text-[14px] leading-relaxed">
                    <span className="evidence-quote px-[3px] py-[1px]">&ldquo;{cut.quote}&rdquo;</span>
                    {cut.seconds_saved !== undefined && (
                      <span className="timestamp-chip ml-2">~{cut.seconds_saved}s back</span>
                    )}
                    <span className="mt-1 block text-[13px]" style={{ color: 'var(--slate)' }}>
                      {cut.reason}
                    </span>
                  </li>
                ))}
              </ul>
              {r.time_coaching.cuts.some((c) => c.seconds_saved !== undefined) && (
                <p className="mono mt-3 text-[12px]" style={{ color: 'var(--slate)' }}>
                  Cutting all of these buys back ~
                  {Math.round(r.time_coaching.cuts.reduce((a, c) => a + (c.seconds_saved ?? 0), 0))}s
                  at your measured pace.
                </p>
              )}
            </div>
          )}

          {r.time_coaching.additions.length > 0 && (
            <div className="mt-4">
              <p className="label mb-2">Worth adding</p>
              <ul className="flex flex-col gap-2">
                {r.time_coaching.additions.map((add, i) => (
                  <li key={i} className="flex gap-2 text-[14px] leading-relaxed">
                    <span className="mono text-[var(--pen)]">+</span>
                    <span>
                      {add.suggestion}
                      {add.targets_criterion_id && (
                        <span className="text-[13px]" style={{ color: 'var(--slate)' }}>
                          {' '}
                          — strengthens {nameOf(add.targets_criterion_id)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── next run plan (D-020) */}
      {r.next_run_plan && r.next_run_plan.length > 0 && (
        <section className="card p-5 sm:p-6">
          <p className="label mb-3">Your next run</p>
          <ol className="flex flex-col gap-2">
            {r.next_run_plan.map((step, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                <span className="mono shrink-0 font-medium" style={{ color: 'var(--pen)' }}>
                  {i + 1}.
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── fastest points */}
      {r.point_gaps_ranked.length > 0 && (
        <section>
          <h3 className="label mb-2 px-1">Fastest points</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {r.point_gaps_ranked.slice(0, 3).map((g) => {
              const crit = r.criteria.find((c) => c.criterion_id === g.criterion_id);
              return (
                <div key={g.criterion_id} className="card p-4" style={{ borderColor: 'var(--ink)' }}>
                  <p className="mono text-[30px] font-medium leading-none" style={{ color: 'var(--pen)' }}>
                    +{g.points_available}
                  </p>
                  <p className="mt-2 text-[14px] font-semibold leading-tight">{nameOf(g.criterion_id)}</p>
                  <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--slate)' }}>
                    {crit?.improvements[0]}
                  </p>
                  <span className="chip mt-3">{g.difficulty}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['rubric', 'Rubric feedback'],
            ['qa', `Judge Q&A (${run.qa.questions.length})`],
            ['transcript', 'Transcript'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key}
            className={`chip cursor-pointer px-4 py-2 text-[13px] ${tab === key ? 'chip-active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── rubric feedback: each criterion is an Evidence Line, stacked on goldenrod */}
      {tab === 'rubric' && (
        <div className="flex flex-col gap-4">
          {r.criteria.map((c, i) => (
            <EvidenceLine
              key={c.criterion_id}
              code={`ITEM ${String(i + 1).padStart(2, '0')}`}
              name={nameOf(c.criterion_id)}
              score={c.score}
              maxPoints={c.max_points}
              assessable={c.assessable}
              notAssessableReason={c.not_assessable_reason}
              confidence={c.confidence}
              justification={c.justification}
              whatWorked={c.what_worked}
              evidence={c.evidence.map((e) => ({
                quote: e.quote,
                source: e.source,
                timestampS: e.source === 'transcript' ? e.timestamp_start : undefined,
              }))}
              improvements={c.improvements}
              defaultExpanded
            />
          ))}
        </div>
      )}

      {/* ── Q&A: not a score, stays white */}
      {tab === 'qa' && (
        <div className="flex flex-col gap-3">
          {run.qa.questions.map((q, i) => (
            <article key={i} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[16px] font-semibold leading-snug">{q.question}</p>
                <span className="chip shrink-0">{q.difficulty}</span>
              </div>

              {revealed.has(i) ? (
                <div className="mt-4">
                  <p className="text-[13px]" style={{ color: 'var(--slate)' }}>
                    Why a judge asks this: {q.targets}
                  </p>
                  <p className="label mt-4">A winning answer hits</p>
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {q.answer_points.map((p, j) => (
                      <li key={j} className="flex gap-2 text-[14px] leading-relaxed">
                        <span className="mono text-[var(--pen)]">&middot;</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <button
                  onClick={() => setRevealed(new Set(revealed).add(i))}
                  className="btn btn-secondary mt-3 h-9 px-3 text-[12px]"
                >
                  Answer out loud first · then reveal
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {/* ── transcript: not a score, stays white */}
      {tab === 'transcript' && (
        <div className="card p-5">
          {run.transcript.segments.map((s, i) => (
            <div key={i} className="flex gap-3 py-1">
              <span className="mono shrink-0 pt-0.5 text-[11px]" style={{ color: 'var(--slate)' }}>
                {mmss(s.start)}
              </span>
              <span className="text-[15px] leading-relaxed">{s.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onAgain} className="btn btn-secondary px-6 text-[14px]">
          Run it again
        </button>
        <button
          onClick={() => void exportPdf()}
          disabled={exporting}
          className="btn btn-primary px-6 text-[14px]"
        >
          {exporting ? 'Building your PDF…' : 'Export full report (PDF)'}
        </button>
        {exportError && (
          <p className="text-[13px]" style={{ color: 'var(--mark)' }} role="alert">
            {exportError}
          </p>
        )}
      </div>

      <footer className="rounded p-4 text-[11px] leading-relaxed" style={{ background: 'var(--card)', border: '1px solid var(--rule-2)', color: 'var(--slate)' }}>
        <p className="mono mb-2" style={{ color: 'var(--ink)' }}>
          run {run.run_id} · {run.model_version} · prompt {run.prompt_version} ·{' '}
          {run.cost_cents.toFixed(1)}¢
          {run.validation.hallucinated_quotes_stripped > 0 &&
            ` · ${run.validation.hallucinated_quotes_stripped} unsupported quote(s) stripped`}
        </p>
        {run.providers && (
          <p className="mono mb-2">
            heard by {run.providers.transcribe} · watched by {run.providers.visual} · judged by{' '}
            {run.providers.judge}
          </p>
        )}
        <p>
          AI practice feedback — not official judging. Real scores will differ. Rubrix is an
          independent student-built practice tool and is not affiliated with, sponsored by, or
          endorsed by FBLA, DECA, TSA, HOSA, or FPSPI. AI practice scores are estimates for
          preparation only and do not predict official results.
        </p>
      </footer>
    </div>
  );
}
