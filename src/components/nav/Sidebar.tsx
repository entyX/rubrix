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
    <nav aria-label="Events" className="flex flex-col gap-3">
      {orgs.map((org) => {
        const isOpen = open[org.id] ?? false;
        return (
          <div key={org.id} className="nb bg-white">
            {/* ── org header */}
            <button
              onClick={() => toggle(org.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-3 py-3 text-left"
              style={{ background: org.color, color: '#fff' }}
            >
              <span
                className="mono text-[15px] font-bold leading-none transition-transform"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}
                aria-hidden
              >
                ▸
              </span>
              <span className="display flex-1 text-[17px] uppercase">{org.name}</span>
              <span
                className="mono border-2 border-black bg-white px-1.5 py-0.5 text-[11px] font-bold"
                style={{ color: '#0a0a0a' }}
              >
                {org.total === 0 ? '0' : `${org.ready}/${org.total}`}
              </span>
            </button>

            {isOpen && (
              <div className="border-t-[3px] border-black p-2">
                {org.total === 0 ? (
                  <p className="px-2 py-4 text-center text-[13px] font-medium opacity-60">
                    Nothing here yet.
                  </p>
                ) : (
                  org.groups.map((g) => (
                    <div key={g.category} className="mb-3 last:mb-1">
                      <p className="display mb-1.5 px-1 text-[11px] uppercase tracking-wider opacity-55">
                        {CATEGORY_LABEL[g.category]} · {g.events.length}
                      </p>

                      <ul className="flex flex-col gap-0.5">
                        {g.events.map((e) => {
                          const isSel = selected?.slug === e.slug;
                          // Three states, not two. A rubric FILE existing is not the same as
                          // a human having checked it — only 'confirmed' can grade (F3).
                          const state =
                            e.rubric_status === 'confirmed'
                              ? { fill: 'var(--lime)', label: '' }
                              : e.rubric_status === 'unreviewed'
                                ? { fill: 'var(--yellow)', label: 'review' }
                                : { fill: 'transparent', label: 'set up' };

                          return (
                            <li key={e.slug}>
                              <button
                                onClick={() => onSelect(e)}
                                aria-current={isSel}
                                className="nb-row flex w-full items-center gap-2 px-2 py-1.5 text-left"
                              >
                                <span
                                  className="h-2.5 w-2.5 shrink-0 border-2 border-black"
                                  style={{ background: state.fill }}
                                  aria-hidden
                                />
                                <span className="flex-1 text-[13px] font-medium leading-snug">
                                  {e.name}
                                </span>
                                {/* Colour is never the only signal (plan.md §11.8). */}
                                {state.label && (
                                  <span className="text-[10px] font-bold uppercase opacity-55">
                                    {state.label}
                                  </span>
                                )}
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

      <p className="px-1 pt-1 text-[11px] leading-relaxed opacity-55">
        <strong>Green</strong> = a human checked the rubric; it can grade.{' '}
        <strong>Yellow (review)</strong> = machine-read from the official sheet, waiting on you.{' '}
        <strong>Empty (set up)</strong> = no rubric yet. Nobody is scored against a rubric no human
        has confirmed.
      </p>
    </nav>
  );
}
