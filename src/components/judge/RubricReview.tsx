'use client';

/**
 * The mandatory human review table — plan.md F3.
 *
 *   "Path B: upload PDF → extract → parse to structured JSON → mandatory human review
 *    table (editable) → confirm → locked canonical. Never grade on an unreviewed parse."
 *
 * A machine read the rating sheet. It is probably right. "Probably" is not good enough to
 * put a number on a student's practice, so a human checks it here first. Point values are
 * editable, because that's the field the parse is most likely to get wrong.
 */
import { useEffect, useState } from 'react';
import type { CatalogEvent } from '@/lib/rubrics/types';

interface Criterion {
  id: string;
  name: string;
  description: string;
  max_points: number;
}
interface ParsedRubric {
  title: string;
  total_points: number;
  criteria: Criterion[];
  _review?: { warnings?: string[]; source_pdf?: string };
}

export function RubricReview({
  event,
  onConfirmed,
}: {
  event: CatalogEvent;
  onConfirmed: () => void;
}) {
  const [rubric, setRubric] = useState<ParsedRubric | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetch(`/api/rubrics?id=${encodeURIComponent(event.rubric ?? '')}`);
      const j = await res.json();
      if (live) setRubric(j.rubric ?? null);
    })();
    return () => {
      live = false;
    };
  }, [event.rubric]);

  if (!rubric) {
    return (
      <div className="nb bg-white p-6">
        <p className="display text-[16px] uppercase">Loading the parse…</p>
      </div>
    );
  }

  const sum = rubric.criteria.reduce((a, c) => a + (Number(c.max_points) || 0), 0);
  const mismatch = Math.abs(sum - rubric.total_points) > 0.01;
  const warnings = rubric._review?.warnings ?? [];

  const setPoints = (i: number, v: string) =>
    setRubric((r) =>
      r
        ? {
            ...r,
            criteria: r.criteria.map((c, j) =>
              j === i ? { ...c, max_points: Number(v) || 0 } : c,
            ),
          }
        : r,
    );

  const remove = (i: number) =>
    setRubric((r) => (r ? { ...r, criteria: r.criteria.filter((_, j) => j !== i) } : r));

  const confirm = async () => {
    setSaving(true);
    setError('');
    const res = await fetch('/api/rubrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: event.rubric,
        rubric: {
          title: rubric.title,
          total_points: rubric.total_points,
          criteria: rubric.criteria,
        },
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error?.message ?? "That didn't save.");
      return;
    }
    onConfirmed();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="nb bg-[var(--orange)] p-5">
        <h3 className="display text-[22px] leading-tight">CHECK THIS BEFORE IT SCORES ANYONE.</h3>
        <p className="mt-2 text-[15px] font-semibold leading-relaxed">
          A machine read the official rating sheet for {event.name} and produced the rows below. It
          is probably right — but a wrong rubric gives a confident, wrong score, which is worse
          than no score. Compare it against{' '}
          <code className="mono text-[13px]">{rubric._review?.source_pdf ?? event.source_pdf}</code>{' '}
          and fix anything that’s off. Nothing can be graded against this until you confirm it.
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="nb bg-[var(--pink)] p-4">
          <p className="display mb-2 text-[11px] uppercase tracking-wider">Look at these first</p>
          <ul className="flex flex-col gap-1.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-[14px] font-semibold leading-relaxed">
                · {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="nb bg-white p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="display text-[18px]">{rubric.title}</h4>
          <p className="mono text-[14px] font-bold">
            {rubric.criteria.length} criteria ·{' '}
            <span style={{ color: mismatch ? 'var(--lo)' : 'inherit' }}>
              {sum} pts
              {mismatch && ` (sheet says ${rubric.total_points})`}
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {rubric.criteria.map((c, i) => (
            <div
              key={c.id}
              className="nb-flat flex items-start gap-3 bg-[var(--paper)] p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold leading-snug">{c.name}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed opacity-65">{c.description}</p>
              </div>
              <label className="shrink-0">
                <span className="sr-only">Max points for {c.name}</span>
                <input
                  type="number"
                  min={0}
                  value={c.max_points}
                  onChange={(e) => setPoints(i, e.target.value)}
                  className="mono nb-flat w-[68px] bg-white px-2 py-1.5 text-right text-[15px] font-bold"
                />
              </label>
              <button
                onClick={() => remove(i)}
                aria-label={`Remove ${c.name}`}
                className="nb-btn shrink-0 bg-white px-2.5 py-1.5 text-[11px]"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {mismatch && (
          <p className="nb-flat mt-4 bg-[var(--yellow)] p-3 text-[13px] font-bold leading-relaxed">
            The rows add up to {sum}, but the sheet states {rubric.total_points}. Real rating sheets
            sometimes genuinely don’t add up, so this isn’t automatically wrong — but check it.
          </p>
        )}
      </div>

      {error && (
        <div className="nb bg-[var(--pink)] p-4 text-[15px] font-bold" role="alert">
          {error}
        </div>
      )}

      <button
        onClick={() => void confirm()}
        disabled={saving || rubric.criteria.length === 0}
        className="nb-btn self-start bg-[var(--lime)] px-6 py-3.5 text-[15px]"
      >
        {saving ? 'Saving…' : 'This matches the sheet — confirm it'}
      </button>
    </div>
  );
}
