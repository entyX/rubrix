'use client';

/**
 * App shell: sidebar + workspace. The sidebar collapses to a drawer under 1024px so the
 * whole thing still works at 360px (design brief §8 responsive floor).
 */
import { useState } from 'react';
import { Sidebar } from './nav/Sidebar';
import { JudgeApp } from './judge/JudgeApp';
import type { CatalogEvent, OrgSection } from '@/lib/rubrics/types';

export function Shell({ orgs }: { orgs: OrgSection[] }) {
  const [selected, setSelected] = useState<CatalogEvent | null>(null);
  const [drawer, setDrawer] = useState(false);

  const pick = (e: CatalogEvent) => {
    setSelected(e);
    setDrawer(false);
  };

  return (
    <div className="mx-auto flex min-h-full max-w-[1400px] flex-col lg:flex-row">
      {/* ── mobile bar */}
      <div
        className="sticky top-0 z-30 flex items-center gap-3 px-4 py-3 lg:hidden"
        style={{ background: 'var(--ink)', borderBottom: '1px solid var(--ink-line)' }}
      >
        <button
          onClick={() => setDrawer((d) => !d)}
          className="btn btn-secondary h-9 px-3 text-[13px]"
          style={{ borderColor: 'var(--ink-line)', color: '#fff' }}
        >
          {drawer ? 'Close' : 'Events'}
        </button>
        <span className="display text-[16px]" style={{ color: '#fff' }}>
          Rubrix
        </span>
      </div>

      {/* ── sidebar
          Scrolls on its own. FBLA alone is 44 events, so without this the other four
          CTSOs get pushed a mile below the fold and are effectively unreachable. */}
      <aside
        className={`${drawer ? 'block' : 'hidden'} shrink-0 px-3 pb-4 lg:sticky lg:top-0 lg:block lg:h-screen lg:w-[320px] lg:overflow-y-auto lg:py-6 lg:pl-6 lg:pr-3`}
      >
        <div className="mb-5 hidden lg:block">
          <h1 className="display text-[26px] leading-none">Rubrix</h1>
          <p className="label mt-2">Pick your event</p>
        </div>
        <Sidebar orgs={orgs} selected={selected} onSelect={pick} />
      </aside>

      {/* ── workspace */}
      <main className="min-w-0 flex-1 px-3 py-4 pb-16 lg:px-6 lg:py-6">
        {selected ? (
          <JudgeApp key={selected.slug} event={selected} />
        ) : (
          <Empty hasAny={orgs.some((o) => o.total > 0)} />
        )}
      </main>
    </div>
  );
}

/** Never show a blank page. */
function Empty({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="card flex min-h-[70vh] flex-col items-center justify-center p-8 text-center">
      <p className="label mb-4">No event selected</p>
      <h2 className="display max-w-[18ch] text-[34px] leading-[1.05] sm:text-[46px]">
        Know your score before the judges do.
      </h2>
      <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed" style={{ color: 'var(--slate)' }}>
        {hasAny
          ? 'Pick an event on the left. Record a practice run or drop one in, and get it back scored line by line against the official rubric — with the exact words that earned each mark.'
          : 'No events loaded yet. Drop the official rating-sheet PDFs into the rubrics folder and run `npm run catalog`.'}
      </p>
    </div>
  );
}
