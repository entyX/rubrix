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
 *
 * Nothing here is scored yet, so this screen stays white/paper — goldenrod is reserved for
 * surfaces that have actually been graded (DECISIONS D-017).
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
      <div className="card p-6">
        <p className="display-md text-[16px]">
          Loading the parse<span className="blink">&hellip;</span>
        </p>
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
      <div className="card p-5" style={{ borderColor: 'var(--ink)' }}>
        <p className="label mb-2">Before this scores anyone</p>
        <h3 className="display-md text-[20px] leading-tight">Check this against the sheet.</h3>
        <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--slate)' }}>
          A machine read the official rating sheet for {event.name} and produced the rows below. It
          is probably right — but a wrong rubric gives a confident, wrong score, which is worse
          than no score. Compare it against{' '}
          <code className="mono text-[13px]">{rubric._review?.source_pdf ?? event.source_pdf}</code>{' '}
          and fix anything that&rsquo;s off. Nothing can be graded against this until you confirm it.
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="card p-4" style={{ borderLeft: '3px solid var(--mark)' }}>
          <p className="label mb-2">Look at these first</p>
          <ul className="flex flex-col gap-1.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-[14px] leading-relaxed">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="display-md text-[18px]">{rubric.title}</h4>
          <p className="mono text-[14px]">
            {rubric.criteria.length} criteria &middot;{' '}
            <span style={{ color: mismatch ? 'var(--mark)' : 'inherit' }}>
              {sum} pts
              {mismatch && ` (sheet says ${rubric.total_points})`}
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {rubric.criteria.map((c, i) => (
            <div key={c.id} className="flex items-start gap-3 rounded p-3" style={{ background: 'var(--paper)' }}>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-snug">{c.name}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: 'var(--slate)' }}>
                  {c.description}
                </p>
              </div>
              <label className="shrink-0">
                <span className="sr-only">Max points for {c.name}</span>
                <input
                  type="number"
                  min={0}
                  value={c.max_points}
                  onChange={(e) => setPoints(i, e.target.value)}
                  className="mono w-[68px] rounded border border-[var(--rule-2)] bg-white px-2 py-1.5 text-right text-[15px] font-medium"
                />
              </label>
              <button
                onClick={() => remove(i)}
                aria-label={`Remove ${c.name}`}
                className="btn btn-secondary h-9 shrink-0 px-2.5 text-[11px]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {mismatch && (
          <p className="mt-4 rounded p-3 text-[13px] leading-relaxed" style={{ background: 'var(--paper)', color: 'var(--slate)' }}>
            The rows add up to {sum}, but the sheet states {rubric.total_points}. Real rating sheets
            sometimes genuinely don&rsquo;t add up, so this isn&rsquo;t automatically wrong — but check it.
          </p>
        )}
      </div>

      {error && (
        <div className="card p-4 text-[15px]" style={{ borderLeft: '3px solid var(--mark)', color: 'var(--mark)' }} role="alert">
          {error}
        </div>
      )}

      <button
        onClick={() => void confirm()}
        disabled={saving || rubric.criteria.length === 0}
        className="btn btn-primary self-start px-6"
      >
        {saving ? 'Saving…' : 'This matches the sheet — confirm it'}
      </button>
    </div>
  );
}
