'use client';

/**
 * The grade report — plan.md §12 "the money screen", in the new skin.
 *
 * Score → fastest points → tabs (rubric feedback · judge Q&A · transcript).
 * A criterion the submission couldn't evidence says so out loud instead of showing a
 * confident zero, and a low-confidence score is flagged rather than dressed up (§9.7).
 */
import { useState } from 'react';
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
  cost_cents: number;
}

const TIER: Record<string, { label: string; bg: string }> = {
  needs_work: { label: 'Needs work', bg: 'var(--pink)' },
  competitive_regional: { label: 'Regional-ready', bg: 'var(--orange)' },
  competitive_state: { label: 'State-ready', bg: 'var(--yellow)' },
  competitive_national: { label: 'Nationals-ready', bg: 'var(--lime)' },
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const barColor = (pct: number) =>
  pct >= 85 ? 'var(--lime)' : pct >= 60 ? 'var(--yellow)' : 'var(--pink)';

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

  const r = run.result;
  const possible = r.assessable_possible ?? r.total_possible;
  const pct = possible > 0 ? (r.total_score / possible) * 100 : 0;
  const notJudged = run.validation.not_assessable_points;
  const tier = TIER[r.tier] ?? { label: r.tier, bg: 'var(--yellow)' };

  const nameOf = (id: string) => run.rubric.criteria.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-4">
      {/* ── score */}
      <header className="nb nb-lg bg-white p-6 sm:p-8">
        <p className="display text-[11px] uppercase tracking-wider opacity-60">
          {event.org.toUpperCase()} · {event.name}
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
          <span className="display mono text-[72px] leading-[0.85] sm:text-[92px]">
            {r.total_score}
          </span>
          <span className="display mono pb-1 text-[28px] opacity-45">/ {possible}</span>
          <span
            className="nb-sm ml-auto border-[3px] border-black px-3 py-1.5"
            style={{ background: tier.bg }}
          >
            <span className="display text-[15px] uppercase">{tier.label}</span>
          </span>
        </div>

        <div className="nb-bar mt-5 h-7">
          <span style={{ width: `${pct}%`, background: barColor(pct) }} />
        </div>
        <p className="mono mt-2 text-[13px] font-bold">{pct.toFixed(1)}%</p>

        {notJudged > 0 && (
          <div className="nb-flat mt-5 bg-[var(--cyan)] p-4">
            <p className="text-[13px] font-semibold leading-relaxed">
              Of the rubric’s {r.total_possible} points, <strong>{notJudged}</strong> weren’t judged
              — your submission didn’t contain the evidence for them. You have <strong>not</strong>{' '}
              been marked down; they’re simply left out of the score above.
            </p>
            {onAnswerQuestions && (
              <>
                <p className="mt-3 text-[13px] font-semibold leading-relaxed">
                  Some of those need you to answer the judge’s questions. Do the drill and they get
                  scored for real.
                </p>
                <button
                  onClick={onAnswerQuestions}
                  className="nb-btn mt-3 bg-[var(--lime)] px-4 py-2.5 text-[13px]"
                >
                  Answer the judge’s questions →
                </button>
              </>
            )}
          </div>
        )}

        <div className="mono mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px] font-bold opacity-70">
          <span>{mmss(run.metrics.duration_s)}</span>
          <span>{run.metrics.words_per_minute} WPM</span>
          <span>{run.metrics.filler_count} FILLERS</span>
          {r.timing && <span>{r.timing.over ? 'OVER TIME' : 'WITHIN TIME'}</span>}
        </div>
      </header>

      {/* ── summary */}
      <section className="nb bg-[var(--violet)] p-5 sm:p-6">
        <p className="display mb-2 text-[11px] uppercase tracking-wider">The judge’s note</p>
        <p className="text-[17px] font-semibold leading-relaxed">{r.summary}</p>
      </section>

      {/* ── fastest points */}
      {r.point_gaps_ranked.length > 0 && (
        <section>
          <h3 className="display mb-2 px-1 text-[13px] uppercase tracking-wider opacity-60">
            Fastest points
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {r.point_gaps_ranked.slice(0, 3).map((g, i) => {
              const crit = r.criteria.find((c) => c.criterion_id === g.criterion_id);
              const bg = [ 'var(--lime)', 'var(--yellow)', 'var(--orange)' ][i] ?? 'var(--yellow)';
              return (
                <div key={g.criterion_id} className="nb p-4" style={{ background: bg }}>
                  <p className="display mono text-[34px] leading-none">+{g.points_available}</p>
                  <p className="mt-2 text-[14px] font-bold leading-tight">
                    {nameOf(g.criterion_id)}
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed">{crit?.improvements[0]}</p>
                  <span className="tag mt-3 bg-white">{g.difficulty}</span>
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
            className="nb-btn px-4 py-2 text-[13px]"
            style={{ background: tab === key ? 'var(--ink)' : '#fff', color: tab === key ? '#fff' : 'var(--ink)' }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── rubric feedback */}
      {tab === 'rubric' && (
        <div className="flex flex-col gap-4">
          {r.criteria.map((c) => {
            const cpct = c.max_points > 0 ? (c.score / c.max_points) * 100 : 0;
            return (
              <article key={c.criterion_id} className="nb bg-white p-5">
                <div className="flex items-start justify-between gap-4">
                  <h4 className="display text-[17px] leading-tight">{nameOf(c.criterion_id)}</h4>
                  <span className="display mono shrink-0 text-[20px]">
                    {c.assessable ? c.score : '—'}
                    <span className="opacity-40">/{c.max_points}</span>
                  </span>
                </div>

                {c.assessable ? (
                  <div className="nb-bar mt-3 h-3.5">
                    <span style={{ width: `${cpct}%`, background: barColor(cpct) }} />
                  </div>
                ) : (
                  <p className="nb-flat mt-3 bg-[var(--cyan)] p-3 text-[13px] font-semibold leading-relaxed">
                    <strong>Not judged. </strong>
                    {c.not_assessable_reason}
                  </p>
                )}

                {c.assessable && (
                  <>
                    {c.confidence !== 'high' && (
                      <p className="nb-flat mt-3 bg-[var(--orange)] p-3 text-[13px] font-bold leading-relaxed">
                        Judge’s note: hard to assess from this recording
                        {c.not_assessable_reason ? ` — ${c.not_assessable_reason}` : '.'}
                      </p>
                    )}

                    <p className="mt-3 text-[15px] leading-relaxed">{c.justification}</p>

                    {c.evidence.map((e, i) => (
                      <blockquote
                        key={i}
                        className="mt-3 border-l-[5px] border-black bg-[var(--paper)] py-2 pl-3 pr-2 text-[14px] italic leading-relaxed"
                      >
                        {e.source === 'transcript' && e.timestamp_start !== undefined && (
                          <span className="mono mr-2 not-italic text-[11px] font-bold">
                            [{mmss(e.timestamp_start)}]
                          </span>
                        )}
                        “{e.quote}”
                      </blockquote>
                    ))}

                    <ul className="mt-4 flex flex-col gap-1.5">
                      {c.improvements.map((im, i) => (
                        <li key={i} className="flex gap-2 text-[14px] leading-relaxed">
                          <span className="font-bold">→</span>
                          <span>{im}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* ── Q&A */}
      {tab === 'qa' && (
        <div className="flex flex-col gap-3">
          {run.qa.questions.map((q, i) => (
            <article key={i} className="nb bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[16px] font-bold leading-snug">{q.question}</p>
                <span className="tag shrink-0 bg-[var(--yellow)]">{q.difficulty}</span>
              </div>

              {revealed.has(i) ? (
                <div className="mt-4">
                  <p className="text-[13px] font-semibold opacity-70">
                    Why a judge asks this: {q.targets}
                  </p>
                  <p className="display mt-4 text-[11px] uppercase tracking-wider opacity-60">
                    A winning answer hits
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {q.answer_points.map((p, j) => (
                      <li key={j} className="flex gap-2 text-[14px] leading-relaxed">
                        <span className="font-bold">·</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <button
                  onClick={() => setRevealed(new Set(revealed).add(i))}
                  className="nb-btn mt-3 bg-[var(--cyan)] px-3 py-1.5 text-[11px]"
                >
                  Answer out loud first · then reveal
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {/* ── transcript */}
      {tab === 'transcript' && (
        <div className="nb bg-white p-5">
          {run.transcript.segments.map((s, i) => (
            <div key={i} className="flex gap-3 py-1">
              <span className="mono shrink-0 pt-0.5 text-[11px] font-bold opacity-60">
                {mmss(s.start)}
              </span>
              <span className="text-[15px] leading-relaxed">{s.text}</span>
            </div>
          ))}
        </div>
      )}

      <button onClick={onAgain} className="nb-btn self-start bg-[var(--lime)] px-6 py-3 text-[15px]">
        Run it again
      </button>

      <footer className="nb-flat bg-white p-4 text-[11px] leading-relaxed">
        <p className="mono mb-2 font-bold">
          run {run.run_id} · {run.model_version} · prompt {run.prompt_version} ·{' '}
          {run.cost_cents.toFixed(1)}¢
          {run.validation.hallucinated_quotes_stripped > 0 &&
            ` · ${run.validation.hallucinated_quotes_stripped} unsupported quote(s) stripped`}
        </p>
        <p className="opacity-70">
          AI practice feedback — not official judging. Real scores will differ. Rubrix is an
          independent student-built practice tool and is not affiliated with, sponsored by, or
          endorsed by FBLA, DECA, TSA, HOSA, or FPSPI. AI practice scores are estimates for
          preparation only and do not predict official results.
        </p>
      </footer>
    </div>
  );
}
