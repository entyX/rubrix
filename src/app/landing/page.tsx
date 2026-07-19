import type { Metadata } from 'next';
import Link from 'next/link';
import { EvidenceLine } from '@/components/EvidenceLine';

export const metadata: Metadata = {
  title: 'Rubrix — Know your score before the judges do',
  description:
    'Upload a practice run of your FBLA, DECA, TSA, or HOSA event and get scored line by line against the official rubric, with the exact quote and timestamp behind every point.',
};

const STEPS = [
  {
    title: 'Upload your rubric',
    body: "Drop in the official rating sheet. We structure it into line items — you check it against the source before anything gets graded.",
  },
  {
    title: 'Upload your run-through',
    body: 'Record or upload a practice run. Only the audio leaves your device; the original video is never stored.',
  },
  {
    title: 'Get scored line by line',
    body: 'Every point comes with the verbatim quote and timestamp that earned it, plus judge-style Q&A to drill before the real thing.',
  },
];

const QUESTIONS = [
  '“You said sales are trending up — what number backs that up?”',
  '“Walk me through why option B beats option A on cost.”',
  '“If a judge pushed back on your timeline, what would you say?”',
];

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      {/* ── hero, ink ── */}
      <section style={{ background: 'var(--ink)', color: '#fff' }}>
        <div className="mx-auto max-w-[1180px] px-4 py-16 sm:px-6 lg:px-6 lg:py-24">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
            <div>
              <p className="label mb-5" style={{ color: 'rgba(255,255,255,.55)' }}>
                An AI judge for FBLA · DECA · TSA · HOSA
              </p>
              <h1 className="display text-[clamp(40px,6.2vw,72px)] leading-[0.98]">
                Know your score before the judges do.
              </h1>
              <p
                className="mt-6 max-w-[46ch] text-[17px] leading-relaxed"
                style={{ color: 'rgba(255,255,255,.72)' }}
              >
                Upload a practice run of your event. Get it back scored line by line against the
                real rubric — with the exact words and timestamp that earned every point.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/" className="btn btn-primary px-6 text-[15px]">
                  Grade a practice run
                </Link>
                <a
                  href="#how-it-works"
                  className="btn btn-secondary px-6 text-[15px]"
                  style={{ borderColor: 'rgba(255,255,255,.4)', color: '#fff' }}
                >
                  See how scoring works
                </a>
              </div>
            </div>

            <EvidenceLine
              animate
              code="ITEM 03"
              name="Uses data to support the recommendation"
              score={4}
              maxPoints={5}
              confidence="high"
              justification="Cites two data points but doesn't tie the second one back to the recommendation."
              evidence={[
                {
                  quote:
                    'foot traffic dropped twelve percent after the change, which tells us',
                  source: 'transcript',
                  timestampS: 252,
                },
              ]}
              improvements={[
                'Name the number out loud a second time, right before the ask',
                'Connect the ad-spend figure explicitly back to the recommendation',
              ]}
            />
          </div>
        </div>
      </section>

      {/* ── how it works, paper ── */}
      <section id="how-it-works" className="px-4 py-16 sm:px-6 sm:py-20 lg:px-6">
        <div className="mx-auto max-w-[1180px]">
          <h2 className="display text-[28px]">How it works</h2>
          <div className="mt-8 flex flex-col gap-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="card interactive flex items-start gap-5 p-5 sm:p-6">
                <span className="label shrink-0 pt-1">STEP {String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3 className="display-md text-[18px]">{s.title}</h3>
                  <p className="mt-1.5 max-w-[62ch] text-[15px] leading-relaxed" style={{ color: 'var(--slate)' }}>
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── the evidence principle ── */}
      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-6" style={{ background: 'var(--card)' }}>
        <div className="mx-auto max-w-[1180px]">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <p className="label mb-3">The rule</p>
              <h2 className="display text-[28px]">No score without evidence.</h2>
              <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed" style={{ color: 'var(--slate)' }}>
                Every point Rubrix awards comes with the exact quote and timestamp that earned
                it — never just a number. And when your submission genuinely doesn&rsquo;t contain
                the evidence for a criterion, we say so instead of guessing.
              </p>
              <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed" style={{ color: 'var(--slate)' }}>
                A criterion the judge can&rsquo;t evidence is left out of your score, not marked
                against you.
              </p>
            </div>
            <EvidenceLine
              code="ITEM 07"
              name="Maintains eye contact with the audience"
              score={null}
              maxPoints={5}
              assessable={false}
              notAssessableReason="Only an audio recording was submitted for this run — attach video or slides next time to have this scored."
            />
          </div>
        </div>
      </section>

      {/* ── Q&A preview ── */}
      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-6">
        <div className="mx-auto max-w-[1180px]">
          <p className="label mb-3">After the score</p>
          <h2 className="display text-[28px]">The judge grills you back.</h2>
          <p className="mt-4 max-w-[60ch] text-[16px] leading-relaxed" style={{ color: 'var(--slate)' }}>
            Every grading run generates judge-style follow-up questions targeting your weakest
            criteria — the same kind you&rsquo;ll get asked live.
          </p>
          <div className="mt-8 flex flex-col gap-2">
            {QUESTIONS.map((q, i) => (
              <div key={q} className="card flex items-start gap-4 p-4">
                <span className="mono text-[13px]" style={{ color: 'var(--slate)' }}>
                  Q{String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-[15px] leading-relaxed">{q}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── org strip ── */}
      <section className="px-4 py-8 sm:px-6 lg:px-6" style={{ borderTop: '1px solid var(--rule-2)', borderBottom: '1px solid var(--rule-2)' }}>
        <div className="mx-auto max-w-[1180px]">
          <p className="label text-center">
            Built for FBLA &middot; DECA &middot; TSA &middot; HOSA events
          </p>
        </div>
      </section>

      {/* ── closing CTA + footer, ink ── */}
      <section style={{ background: 'var(--ink)', color: '#fff' }}>
        <div className="mx-auto max-w-[1180px] px-4 py-16 text-center sm:px-6 sm:py-20 lg:px-6">
          <h2 className="display mx-auto max-w-[20ch] text-[clamp(28px,4vw,44px)] leading-[1.05]">
            Practice like the judges are already watching.
          </h2>
          <div className="mt-8">
            <Link href="/" className="btn btn-primary px-7 text-[15px]">
              Grade a practice run
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-[1180px] px-4 pb-10 sm:px-6 lg:px-6">
          <p className="text-[12px] leading-relaxed" style={{ color: 'rgba(255,255,255,.55)' }}>
            Rubrix is an independent student-built practice tool and is not affiliated with,
            sponsored by, or endorsed by FBLA, DECA, TSA, HOSA, or FPSPI. AI practice scores are
            estimates for preparation only and do not predict official results.
          </p>
        </div>
      </section>
    </div>
  );
}
