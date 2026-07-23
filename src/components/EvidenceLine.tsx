'use client';

/**
 * The signature element (design brief §5): the whole product in one row.
 * A score never renders without its verbatim quote and timestamp in the same
 * visual block. Used three places: the report's rubric tab (real data), the
 * landing hero (`animate`, one live example), and the landing "how it works"
 * section (the row shape as a layout module).
 */
import { useState } from 'react';

export interface EvidenceQuote {
  quote: string;
  timestampS?: number;
  source?: 'transcript' | 'document' | 'visual';
}

export interface EvidenceLineProps {
  code?: string;
  name: string;
  score: number | null;
  maxPoints: number;
  assessable?: boolean;
  notAssessableReason?: string;
  confidence?: 'high' | 'medium' | 'low';
  justification?: string;
  /** D-020: the strongest genuine moment for this criterion. Plain "nothing stood
   *  out" statements render too — honest is the house style. */
  whatWorked?: string;
  /** D-033: the concrete path from this score to full marks — the "get to 100%" target. */
  toFullMarks?: string;
  evidence?: EvidenceQuote[];
  improvements?: string[];
  /** D-029: example sentences the competitor could say to raise this criterion. */
  sampleLines?: string[];
  defaultExpanded?: boolean;
  /** The one real animation on the site — hero only, plays once. */
  animate?: boolean;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function EvidenceLine({
  code,
  name,
  score,
  maxPoints,
  assessable = true,
  notAssessableReason,
  confidence,
  justification,
  whatWorked,
  toFullMarks,
  evidence = [],
  improvements = [],
  sampleLines = [],
  defaultExpanded = false,
  animate = false,
}: EvidenceLineProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <article
      className={`sheet p-5 ${animate ? 'evidence-animate' : ''}`}
      style={{ color: 'var(--ink)' }}
    >
      <div className="sheet-head mb-4 flex items-start justify-between gap-4 pb-3">
        <div className="min-w-0">
          {code && <p className="label mb-1">{code}</p>}
          <h4 className="display-md text-[17px] leading-snug">{name}</h4>
        </div>
        <span className={`mono shrink-0 text-[20px] font-medium ${animate ? 'ev-score' : ''}`}>
          {assessable ? score : '—'}
          <span className="text-[15px] text-[var(--slate)]"> / {maxPoints}</span>
        </span>
      </div>

      {!assessable ? (
        <p className="text-[14px] leading-relaxed" style={{ borderLeft: '2px solid var(--mark)', paddingLeft: 10, color: 'var(--mark)' }}>
          No evidence found in the transcript{notAssessableReason ? ` — ${notAssessableReason}` : '.'}
        </p>
      ) : (
        <>
          {confidence && confidence !== 'high' && (
            <p className="label mb-3" style={{ color: 'var(--mark)' }}>
              Confidence: {confidence}
              {notAssessableReason ? ` — ${notAssessableReason}` : ''}
            </p>
          )}

          {evidence.map((e, i) => (
            <p key={i} className="ev-quote-text mb-3 text-[15px] leading-relaxed">
              {e.timestampS !== undefined && (
                <span className={`timestamp-chip mr-2 ${animate ? 'ev-chip' : ''}`}>
                  [{mmss(e.timestampS)}]
                </span>
              )}
              <span
                className={`evidence-quote ev-quote-mark px-[3px] py-[1px]`}
                style={{ display: 'inline-block' }}
              >
                {e.source === 'visual' ? `Seen — ${e.quote}` : `“${e.quote}”`}
              </span>
            </p>
          ))}

          {whatWorked && whatWorked !== 'Not assessable.' && (
            <p className="mb-2 text-[14px] leading-relaxed">
              <span className="label mr-2" style={{ color: 'var(--pen)' }}>
                What worked
              </span>
              {whatWorked}
            </p>
          )}

          {justification && (
            <p className="text-[14px] leading-relaxed" style={{ color: 'var(--slate)' }}>
              {justification}
            </p>
          )}

          {toFullMarks && toFullMarks !== 'Not assessable.' && (
            <div
              className="mt-3 p-3"
              style={{
                borderLeft: '2px solid var(--pen)',
                background: 'color-mix(in srgb, var(--pen) 6%, transparent)',
              }}
            >
              <p className="label mb-1" style={{ color: 'var(--pen)' }}>
                Path to full marks
              </p>
              <p className="text-[14px] leading-relaxed">{toFullMarks}</p>
            </div>
          )}

          {improvements.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setExpanded((e) => !e)}
                aria-expanded={expanded}
                className="btn-ghost text-[13px]"
              >
                {expanded ? 'Hide improvements' : `Show improvements (${improvements.length})`}
              </button>
              {expanded && (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {improvements.map((im, i) => (
                    <li key={i} className="flex gap-2 text-[14px] leading-relaxed">
                      <span className="mono text-[var(--pen)]">&rarr;</span>
                      <span>{im}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {sampleLines.length > 0 && (
            <div className="mt-3">
              <p className="label mb-1.5" style={{ color: 'var(--pen)' }}>
                Try saying
              </p>
              <ul className="flex flex-col gap-1.5">
                {sampleLines.map((line, i) => (
                  <li
                    key={i}
                    className="text-[14px] italic leading-relaxed"
                    style={{ borderLeft: '2px solid var(--pen)', paddingLeft: 10 }}
                  >
                    &ldquo;{line}&rdquo;
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </article>
  );
}
