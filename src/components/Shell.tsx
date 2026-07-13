'use client';

/**
 * App shell: sidebar + workspace. The sidebar collapses to a drawer under 1024px so the
 * whole thing still works at 360px (plan.md §11.7 responsive floor).
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
      <div className="nb sticky top-0 z-30 m-3 flex items-center gap-3 bg-[var(--yellow)] px-3 py-2 lg:hidden">
        <button onClick={() => setDrawer((d) => !d)} className="nb-btn bg-white px-3 py-1.5 text-[13px]">
          {drawer ? 'Close' : 'Events'}
        </button>
        <span className="display text-[16px] uppercase">Rubrix</span>
      </div>

      {/* ── sidebar
          Scrolls on its own. FBLA alone is 44 events, so without this the other four
          CTSOs get pushed a mile below the fold and are effectively unreachable. */}
      <aside
        className={`${drawer ? 'block' : 'hidden'} shrink-0 px-3 pb-4 lg:sticky lg:top-0 lg:block lg:h-screen lg:w-[320px] lg:overflow-y-auto lg:py-6 lg:pl-6 lg:pr-3`}
      >
        <div className="mb-4 hidden lg:block">
          <h1 className="display text-[30px] leading-none">RUBRIX</h1>
          <p className="mt-1.5 text-[12px] font-semibold uppercase tracking-wide opacity-60">
            Pick your event
          </p>
        </div>
        <Sidebar orgs={orgs} selected={selected} onSelect={pick} />
      </aside>

      {/* ── workspace */}
      <main className="min-w-0 flex-1 px-3 pb-16 lg:px-6 lg:py-6">
        {selected ? (
          <JudgeApp key={selected.slug} event={selected} />
        ) : (
          <Empty hasAny={orgs.some((o) => o.total > 0)} />
        )}
      </main>
    </div>
  );
}

/** plan.md §15: never show a blank page. */
function Empty({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="nb-lg nb flex min-h-[70vh] flex-col items-center justify-center bg-white p-8 text-center">
      <div
        className="nb mb-6 flex h-20 w-20 items-center justify-center bg-[var(--yellow)]"
        aria-hidden
      >
        <span className="display text-[34px]">?</span>
      </div>
      <h2 className="display max-w-[16ch] text-[34px] leading-[1.05] sm:text-[44px]">
        KNOW YOUR SCORE BEFORE THE JUDGES DO.
      </h2>
      <p className="mt-4 max-w-[48ch] text-[15px] leading-relaxed opacity-70">
        {hasAny
          ? 'Pick an event on the left. Record a practice run or drop one in, and get it back scored line by line against the official rubric — with the exact words that earned each mark.'
          : 'No events loaded yet. Drop the official rating-sheet PDFs into the rubrics folder and run `npm run catalog`.'}
      </p>
    </div>
  );
}
