'use client';

/**
 * The event picker. One collapsible section per CTSO; inside, events grouped by the
 * category the official guidelines themselves declare (presentation / role play / chapter).
 *
 * An org with no events says so plainly rather than rendering an empty shell, and an event
 * with no confirmed rubric is visibly not-ready — you cannot click into a grade that
 * doesn't have a reviewed rubric behind it (plan.md F3).
 */
import { useState } from 'react';
import {
  CATEGORY_LABEL,
  type CatalogEvent,
  type OrgSection,
} from '@/lib/rubrics/types';

export function Sidebar({
  orgs,
  selected,
  onSelect,
}: {
  orgs: OrgSection[];
  selected: CatalogEvent | null;
  onSelect: (e: CatalogEvent) => void;
}) {
  // Open the first org that actually has something in it.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const first = orgs.find((o) => o.total > 0);
    return first ? { [first.id]: true } : {};
  });

  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <nav aria-label="Events" className="flex flex-col gap-2">
      {orgs.map((org) => {
        const isOpen = open[org.id] ?? false;
        return (
          <div key={org.id} className="card overflow-hidden">
            {/* ── org header */}
            <button
              onClick={() => toggle(org.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-3 py-3 text-left"
            >
              <span
                className="mono shrink-0 text-[13px] leading-none transition-transform"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'none', color: 'var(--slate)' }}
                aria-hidden
              >
                &#9656;
              </span>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: org.color }}
                aria-hidden
              />
              <span className="display-md flex-1 text-[15px]">{org.name}</span>
              <span className="label" style={{ color: 'var(--ink)' }}>
                {org.total === 0 ? '0' : `${org.ready}/${org.total}`}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-[var(--rule-2)] p-2">
                {org.total === 0 ? (
                  <p className="px-2 py-4 text-center text-[13px]" style={{ color: 'var(--slate)' }}>
                    Nothing here yet.
                  </p>
                ) : (
                  org.groups.map((g) => (
                    <div key={g.category} className="mb-3 last:mb-1">
                      <p className="label mb-1.5 px-1">
                        {CATEGORY_LABEL[g.category]} &middot; {g.events.length}
                      </p>

                      <ul className="flex flex-col gap-0.5">
                        {g.events.map((e) => {
                          const isSel = selected?.slug === e.slug;
                          // Three states, not two. A rubric FILE existing is not the same as
                          // a human having checked it — only 'confirmed' can grade (F3).
                          const state =
                            e.rubric_status === 'confirmed'
                              ? { dot: 'var(--pen)', filled: true, label: '' }
                              : e.rubric_status === 'unreviewed'
                                ? { dot: 'var(--ink)', filled: false, label: 'review' }
                                : { dot: 'var(--rule)', filled: false, label: 'set up' };

                          return (
                            <li key={e.slug}>
                              <button
                                onClick={() => onSelect(e)}
                                aria-current={isSel}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors"
                                style={{
                                  background: isSel ? 'var(--pen-wash)' : 'transparent',
                                }}
                                onMouseEnter={(ev) => {
                                  if (!isSel) ev.currentTarget.style.background = 'var(--paper)';
                                }}
                                onMouseLeave={(ev) => {
                                  if (!isSel) ev.currentTarget.style.background = 'transparent';
                                }}
                              >
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full border"
                                  style={{
                                    background: state.filled ? state.dot : 'transparent',
                                    borderColor: state.dot,
                                  }}
                                  aria-hidden
                                />
                                <span className="flex-1 text-[13px] leading-snug">{e.name}</span>
                                {/* Colour is never the only signal. */}
                                {state.label && <span className="label">{state.label}</span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      <p className="px-1 pt-1 text-[12px] leading-relaxed" style={{ color: 'var(--slate)' }}>
        <strong style={{ color: 'var(--ink)' }}>Filled</strong>{' '}
        = a human checked the rubric; it can grade.{' '}
        <strong style={{ color: 'var(--ink)' }}>Review</strong>{' '}
        = machine-read from the official sheet, waiting on you.{' '}
        <strong style={{ color: 'var(--ink)' }}>Set up</strong>{' '}
        = no rubric yet.
      </p>
    </nav>
  );
}
