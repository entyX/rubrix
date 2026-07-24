# DECISIONS

plan.md §0: *"Keep DECISIONS.md (choices + why)."* Newest last. Anything here that
contradicts `plan.md` is an **amendment to the spec**, made by a human, recorded so the
spec is not left quietly lying.

---

## D-001 — The product is called **Rubrix**, not Podium

**Date:** 2026-07-12 · **By:** agent, resolved from the docs (no human input needed)

`CLAUDE.md` opened with "You are building PODIUM"; `plan.md` says Rubrix throughout; the repo
is `rubrix`. Both files declare `plan.md` the single source of truth, and `CLAUDE.md` defers to
it explicitly. So **Rubrix wins** and `CLAUDE.md` has been corrected.

Note `plan.md` §23 still lists locking the name (trademark + domain) as an open task. Rubrix is
the working name, not yet a cleared one.

---

## D-002 — Grading and transcription both move to **Gemini 2.5 Flash**

**Date:** 2026-07-12 · **By:** Ronit (explicit instruction) · **Amends:** plan.md §6, §9.1, §9.8

`plan.md` §6 fixes the stack as **Anthropic Claude** for grading + **OpenAI Whisper** for
transcription, and says "do not relitigate". The human overrode this: one provider, one key,
`gemini-2.5-flash` for both.

**What this bought us — the spec's determinism rule became implementable again.**
§9.5 and `CLAUDE.md` both mandate **temperature 0–0.2 for grading**. That rule is *impossible*
on the current Claude Sonnet-class model, which removed `temperature` and returns a 400 if you
send it. Gemini accepts `temperature`, and additionally exposes a **`seed`** for reproducible
decoding — which directly serves §9.7's run-to-run consistency requirement. The grader now runs
at `temperature: 0.2, seed: 7` exactly as written.

**What it costs us:** transcription timestamps are now model-produced rather than Whisper's.
§9.2's pacing/pause metrics depend on them. Mitigated three ways: timestamps are clamped and
audited in `transcribe.ts` (`sanitizeSegments`), anything repaired is surfaced as a warning
rather than laundered into a metric, and **audio duration is read from the file itself
(`music-metadata`), never from the model**.

**Measured on the M1 run:** 14 segments, monotonic, non-overlapping, final segment ends at
53.3s against a real 54.01s duration; fillers preserved verbatim. Timestamps are good enough.
The escape hatch (swap transcription back to Whisper without touching the grader) stays open —
`transcribeAudioFile()` is the only seam that would move.

---

## D-003 — Use `models.generateContent`, **not** the newer `interactions` API

**Date:** 2026-07-12 · **By:** agent, from measurement

The current Gemini quickstart pushes `ai.interactions.create()`. **Do not use it here.**

On `gemini-2.5-flash` the interactions API **silently ignores `response_format`** — it accepts
the schema, returns HTTP 200, and hands back markdown prose. A silently-unenforced schema in a
grader is a trap: it fails as a *wrong score*, not as an error.

`ai.models.generateContent()` with `responseMimeType: 'application/json'` + `responseSchema`
genuinely enforces the schema (verified: clean raw JSON, all required keys, correct types).
That is what `gemini.ts` uses. §9.7's fence-strip + Zod + retry still runs on top — the model's
output is never trusted, only checked.

Related: `thinkingLevel` is a Gemini 3.5+ knob and 400s on 2.5-flash
("Thinking level is not supported for this model"). 2.5-flash uses the numeric `thinkingBudget`.

---

## D-004 — No FBLA rubrics were written *by the agent*. **RESOLVED by a human.**

**Date:** 2026-07-12 · **By:** agent, refusing to guess → then Ronit supplied the real sheet

`plan.md` §23 asks for hand-structured rubrics. `CLAUDE.md` says, flatly: *"Do not guess at FBLA
rules. Do not make up rubric criteria."* The agent had no official rating sheets, so it invented
**none** and blocked.

**Ronit then supplied the official FBLA Website Coding & Development rating sheet.** It is now
structured at `rubrics/fbla-website-coding-development.rubric.json` — 16 criteria, summing to the
stated 220 points. Per §20 it is *restructured*, not republished: point values are facts from the
sheet, descriptions are our own wording, and the source URL is stored (still `[VERIFY]` — orgs
revise these annually, so check it against the current-year guide before a real run).

`rubrics/_dev-generic-speech.rubric.json` remains, still invented, still labelled as such, still
producing meaningless scores. It exists only to exercise the audio path.

**Still open:** no rubric exists yet for Public Speaking, Sales Presentation, or Business Plan.

---

## D-008 — The judge takes a **website**, not just audio

**Date:** 2026-07-12 · **By:** Ronit ("it's a website") · **Implements:** plan.md §3 / F4

The launch event is *prejudged* (§3 `prejudged_plus_presentation`, grading input: *"PDF or link,
AND/OR video"*). The thing being graded is a **website**. An audio transcript could reach only 4
of that sheet's 16 criteria, so the grader now accepts a live URL or a local source folder, and
optionally the presentation recording on top. Either half, or both.

**Deterministic first, LLM second.** A website makes far more of the rubric *measurable* than a
speech does, and §9.2's principle ("code, not the LLM — trustworthy") is applied hard:
`src/lib/site/metrics.ts` computes, in code, whether stylesheets and scripts are actually in
separate files, alt-text coverage, ARIA/landmark counts, console errors, horizontal overflow at
phone/tablet/desktop, and nav consistency across pages. The judge is handed the answers and told
not to re-derive them by eye. Screenshots go to the model for the genuinely subjective calls
(colour, graphics, layout).

**The honesty problem this created, and the fix.** A website-only entry cannot evidence eye
contact, poise, live Q&A, or in-room protocol — **40 of the 220 points**. Scoring those 0 would
fake a failing grade; scoring them full would inflate. So each criterion now carries an
`assessable` flag, and post-validation reports an **assessable total** (118/180) alongside the
full sheet (of 220), naming exactly what it could not judge and why. The tier is computed off the
assessable percentage. A student is never marked down for something they did not submit.

**Cost:** ~6¢ per website grade (vs ~3¢ for audio), still well inside the 30¢ target.

**Gemini trap worth remembering:** thinking tokens count against `maxOutputTokens`. An 8,000 cap
plus a 4,096 thinking budget truncated the JSON mid-string on a 16-criterion rubric. `grade` is
now sized at 32,000.

---

## D-005 — Time penalties are computed but **not applied**

**Date:** 2026-07-12 · **By:** agent

§9.7 says "Apply the code-computed time penalty." No penalty *formula* appears anywhere in
`plan.md`, and official penalties vary by org and event. Inventing one would be guessing at
FBLA rules.

So: `timing` is computed in code (limit, actual, over/under, note) and shown to the student,
and the note says plainly that real judges apply a penalty here and this practice score does
not. **Zero points are deducted.** Supply the official per-event penalty rule and this becomes
a one-line change in `grade.ts`.

---

## D-016 — The eval harness exists, and it splits "works" from "is accurate"

**Date:** 2026-07-17 · **By:** Ronit ("add the eval harness") + agent · **Implements:** plan.md §10

M10 is built (`scripts/eval.ts`). The one honest constraint drove its whole design: **§10's
headline criterion (Pearson r ≥ 0.8 vs human judges) is uncomputable without real human-scored
recordings, and that data does not exist.** Fabricating human scores to make the gate green would
be the single worst thing this project could do. So the harness has two gates:

1. **Invariant gate — runs today.** Spread, hallucination-survival, in-band, no-regression — all
   machine-checkable. This makes the harness immediately useful as a *regression suite*: change a
   prompt, model, or post-validation and it tells you if you broke the mechanics.
2. **Calibration gate — pending human data.** r ≥ 0.8 and |AI−human| ≤ 8 are fully implemented and
   sit dormant until a case's `human.total` is filled by a real judge.

**It earned its keep on the first run:** it measured that grading at `temperature: 0.2` swung 22
points on identical input, drove the fix to `temperature: 0` (~4× tighter, and it corrected a real
generosity bug), and proved that §9.7's 3-run-median *production* path (currently deferred to Phase
1.5) is actually required to hit the ≤3pt spread bar.

**The load-bearing rule, written into `scripts/eval-cases/case.json` and the runner:** a case's
`human` field is `null` until a human scores it. Never a guess. The gate reports "PENDING", not a
passing zero, when labels are absent.

**Still the top open item.** A passing invariant gate means the grader is *stable and honest*, not
that it is *accurate*. Accuracy needs the golden set: §10's 60 videos × 2 judges (~$2–3K), "the
highest-ROI spend in the plan." That is a data-collection task for a human, and it is now the one
thing between this and a defensible public launch.

---

## D-015 — The judge can SEE the run (opt-in video frames). Amends a "non-negotiable".

**Date:** 2026-07-13 · **By:** Ronit (explicit) · **Amends:** plan.md §20 + CLAUDE.md privacy rule

The pipeline was audio-only by design, so every visual-delivery criterion (body language, eye
contact, poise, appearance, visual aids) came back *not judged* — which deflated scores on
presentation events. Ronit asked for the judge to "have eyes."

**This changes a rule the spec marks non-negotiable** ("the video file never touches our
servers"). It was put to the human as an explicit privacy decision, not assumed. The chosen shape
keeps the *spirit* intact while relaxing the letter:

- **Opt-in, default off.** §20's default stays private. Nothing visual leaves the device unless the
  student ticks a box that says exactly what will happen.
- **The video FILE is still never uploaded.** We sample ~9 still frames *in the browser*
  (`src/lib/video/extractFrames.ts`, canvas — no re-mux of a minor's video), and upload only those
  JPEGs alongside the audio.
- **Never stored.** Frames live in the grading request and in memory for the Q&A re-grade, then
  they're gone. No DB, no disk, no bucket. (There's no persistence layer at all yet — M2.)
- **Honest fidelity.** Stills, not motion. Visual criteria are judged at confidence **medium**, and
  the prompt tells the model to judge only what a frame actually shows and not to infer eye contact
  it can't see. Frame evidence is tagged `source: "visual"` and skips the transcript hallucination
  check (it's a description, not a quote).

Architecturally this is the **same path the website grader already uses** — screenshots → image
parts → Gemini. The only new thing is that the images contain a face, which is exactly why it
needed to be the human's call.

**What did NOT change:** audio is still extracted client-side; the recorder is still audio-only
*unless* the student opts in; the disclaimer and the "refuses to bluff" behaviour are intact (a
criterion with no frames AND no recording is still *not judged*, not zeroed).

Prompt bumped to **g-1.3.0** (rule 5 gained the video-frames branch).

---

## D-013 — No Q&A submitted → the criterion is never scored. Ask the questions instead.

**Date:** 2026-07-13 · **By:** Ronit · **Fixes:** the `assessable`-flag instability

Question-answering criteria used to be scored inconsistently — sometimes excluded, sometimes
given a 0 — swinging a result ~11 points and a whole tier between runs of the *same* recording.

**The rule is now mechanical (prompt g-1.2.0, rule 5b):** if the submission contains no Q&A
session, such a criterion is **always** `assessable: false`. Never scored, never zeroed. A
student cannot answer badly a question nobody asked them.

**But excluding the points is only half an answer** — the student still can't earn them. So the
app asks. After the first grade, the judge's generated questions are put to the student, who
answers by **typing**, **dictating** (Web Speech API — on-device, nothing uploaded), or
**recording audio** (transcribed server-side, same audio-only privacy rule as everything else).
The answers attach to the submission, the grader re-runs, and the criterion is scored for real.

Why this is the right shape: the condition is now a *fact about the submission* (is a Q&A
session present?) rather than a *judgement the model re-litigates every run*. Determinism by
construction beats a tuned prompt.

---

## D-014 — All 44 rating sheets are parsed, and every one of them is gated behind a human

**Date:** 2026-07-13 · **By:** Ronit ("build all the rubrics") + agent

`scripts/parse-rubrics.mts` runs the §9.4 / r-1.0.0 pipeline over every official PDF. The PDF is
passed to the model **intact** — a rating sheet is a table, and a text extractor turns a table
into soup. All 44 parse into valid `RubricJSON`.

**They are all marked `_review.status: "unreviewed"`, and nothing can grade against them.**
plan.md F3: *"never grade on an unreviewed parse."* Enforced in **two** places, because the UI
is not a security boundary:
- The app shows a **review table** (editable point values, deletable rows, parse warnings up
  top) and will not show the recorder until a human clicks confirm.
- `/api/grade` and `/api/qa-grade` return **409** for an unreviewed rubric even if called
  directly.

The automated checks (arithmetic mismatch, >25 criteria, duplicate ids, dropped 0-point rows)
decide **what a human looks at hardest** — they do not replace the human. 36 of 43 carry at
least one warning; most are the benign "dropped the staff-only penalty rows", which §9.4 says
belong in notes rather than criteria.

**A bug worth remembering:** the first `--all` run *overwrote a hand-written rubric*, because
the guard only skipped files marked `confirmed` and hand-written files have no `_review` block
at all. Absence of a marker was read as permission. The guard now skips anything **not**
explicitly `unreviewed` — only files this script produced may be overwritten by it.

(It got lucky: the machine parse of Sales Presentation found the 11th criterion that was cut
off in the screenshot the human supplied — 11 criteria / 110 pts, versus the partial 10 / 100.
Lucky is not a strategy.)

---

## D-011 — Neobrutalism replaces §11 "Championship Metal"

**Date:** 2026-07-13 · **By:** Ronit (explicit instruction) · **Amends:** plan.md §11

`plan.md` §11 specifies "Championship Metal, Cupertino Finish" — dark machined graphite,
gold gradients, frosted glass, soft ambient shadows, restraint. `CLAUDE.md` made compliance with
it mandatory. The human asked instead for **neobrutalism**: flat vivid colour, 3px black
borders, hard offset shadows, heavy display type, no gradients.

These are incompatible aesthetics; you cannot have both. The human's call wins, so §11's
*visual* language is superseded. **The metal tokens, medallion, and glass surfaces are gone.**

**What survives from §11, because it isn't decoration:**
- Colour is never the only signal (§11.8) — the "ready" dot in the sidebar is paired with a
  "SET UP" text label; score bars carry their number.
- Visible focus rings (now a 3px black outline).
- `prefers-reduced-motion` respected — the button press/translate is disabled.
- Responsive to 360px; the sidebar becomes a drawer under 1024px.
- Org accent colours from §11.9 (fbla blue, deca sky, tsa red, hosa rose, fpspi violet).
- Every async view has a real progress state and a real empty state (§15).

**Fonts:** Archivo Black (display) + Space Grotesk (body), via `next/font` — self-hosted and
preloaded, so no runtime request to Google and no layout shift. §11.2 already reserved an
"ARCHIVO" treatment for engraved labels, so the display face was sanctioned even before this.
This is a deliberate departure from §11.7's "fonts system-first"; the human explicitly did not
want default-looking type, and self-hosting keeps the LCP/CLS budget intact.

---

## D-012 — The event catalog is generated from the PDFs, not written by hand

**Date:** 2026-07-13 · **By:** agent

Ronit dropped 44 official FBLA guidelines PDFs into `rubrics/`. The sidebar needs each event's
**category** (presentation / role play / chapter), and `CLAUDE.md` forbids guessing at FBLA
rules — so we don't classify them ourselves.

Every guidelines PDF states its own category verbatim (`"Event Category: Presentation"`,
`"Role Play"`, `"Chapter Event"`). `scripts/build-catalog.mts` extracts that line and uses it.
Result: **30 presentation · 12 role play · 2 chapter · 0 unclassified** — FBLA's own taxonomy,
not ours. Anything without a stated category lands in `unclassified` for a human, rather than
being quietly bucketed.

`npm run catalog` regenerates `rubrics/catalog.json`. Drop in a new PDF, re-run, and the event
appears in the sidebar.

**An event is only gradeable once a human hand-structures its rubric** into
`rubrics/{org}/{category}/{slug}.rubric.json`. Until then the UI shows it as "set up" and
*refuses to grade* — plan.md F3: "never grade on an unreviewed parse". Currently **2 of 44** are
ready (Sales Presentation, Website Coding & Development). The other 42 are a human task.

---

## D-009 — The package is ESM (`"type": "module"`). Do not remove it.

**Date:** 2026-07-12 · **By:** agent, after a genuinely nasty debugging session

`music-metadata` (which gives us the audio duration — and §9.2 says that number must be
**code-computed and trustworthy**) is ESM-only and loads its container parsers via dynamic
`import()`. Without `"type": "module"`, tsx treats every `.ts` file as CommonJS, those dynamic
imports get rewritten to `require()`, and **every parser silently vanishes**.

The symptom is a liar: `Guessed MIME-type not supported: audio/wav` — on a perfectly valid WAV,
whose magic bytes it had *already sniffed correctly*. It looks like a bad file or a bad MIME
label. It is neither. Two plausible-but-wrong fixes (passing an explicit mimeType; converting
Buffer → Uint8Array) were tried and discarded before the real cause surfaced. The tell: the same
call worked from a `.mts` file (ESM) and failed from a `.ts` file (CJS).

Consequences of the switch, all handled: `vitest.config.ts` can no longer use `__dirname`
(uses `fileURLToPath(new URL(...))`). Next, Vitest, ESLint and tsc are all clean on ESM.

**If a future agent sees a bogus "unsupported MIME type" on a valid audio file, check
`package.json` for `"type": "module"` before touching anything else.**

---

## D-010 — Enforce array counts in the Gemini schema, not just in Zod

**Date:** 2026-07-12 · **By:** agent, from a production log line

§9.3 requires 2–4 `improvements` per criterion. The response schema only *described* that, so the
model regularly returned **one**, Zod rejected it, and §9.7's repair loop fired a full second
grading call — silently **doubling the cost and latency of a real user's grade** (observed:
4.3¢/80s → 2.4¢/48s once fixed).

Gemini's `responseSchema` honours `minItems`/`maxItems`. They are now set on `improvements`,
`top_priorities`, `answer_points`, and `questions`. Zod stays strict as the real gate — but the
retry should be the exception, not the routine.

The retry is also now logged with its Zod issues (`[grade] schema retry — …`). A silent retry is
a cost leak you cannot see; that's how this one hid.

---

## D-006 — Tooling: npm, not pnpm

**Date:** 2026-07-12 · **By:** agent

§16 assumes `pnpm`. pnpm is not installed on this machine and npm is. Not worth a yak-shave
during M1. CI (§16) should be written for whichever one survives; switching later is cheap.

---

## D-007 — `point_gaps_ranked` is recomputed in code

**Date:** 2026-07-12 · **By:** agent

§9.5 rule 8 has the model produce `point_gaps_ranked`. It is pure arithmetic over data we
already hold (`max_points - score`, ranked by points × ease-of-fix), and §9.7 already
establishes the principle that arithmetic is recomputed in code and the model's version
overwritten. So we compute it. This also guarantees it can never reference a criterion that
isn't in the rubric.

---

## D-017 — "Score Sheet" replaces neobrutalism (D-011) as the design system

**Date:** 2026-07-18 · **By:** human (explicit design brief) · **Amends:** D-011, plan.md §11

D-011 replaced plan.md §11 "Championship Metal" with a flat neobrutalist skin — hard 3px
borders, offset shadows, flat rainbow tags, Archivo Black + Space Grotesk. The human has now
handed a second, full design brief: **"Score Sheet."** The judge's goldenrod score sheet is
the product's central material — `--sheet #EDE7D1` appears only on surfaces that have
actually been scored (report header, criterion rows) and nowhere else. Ballpoint blue
`--pen #1F3BB3` is the only action colour. Judge's red `--mark #B3261E` is reserved for "no
evidence found" and is never used to mean "you did badly" — a low score with good evidence is
still an honest score, so the palette doesn't shame it. The signature element is
`<EvidenceLine>`: criterion + score, the verbatim quote with a timestamp chip, then the
justification — a score never renders without its evidence in the same visual block.

Neobrutalism is gone: no more `nb-*` primitives, hard offset shadows, or flat rainbow tags.
**What survives, because it isn't decoration (the same list D-011 carried forward from
§11.8):** colour is never the only signal, visible focus rings (now 2px `--pen`, 2px offset),
`prefers-reduced-motion` respected, responsive to 360px, org accent colours (muted so they sit
quietly against the neutral palette instead of competing with it), every async view has a real
progress state and a real empty state.

**Fonts:** Bricolage Grotesque (display), Instrument Sans (body/UI), DM Mono (every score,
timestamp, criterion code, label) — via `next/font/google`, same rationale as D-011: self-hosted
and preloaded, no runtime request to Google, no layout shift.

**Scope of this pass:** reskinned every page that actually exists today (event picker → rubric
review → record/upload → grading progress → report → Q&A drill) and added the public
`/landing` marketing page from plan.md §12. Did **not** build dashboard, wizard, task board,
officer, or settings pages — those need auth + Supabase (M2/M3), which haven't started yet, and
`CLAUDE.md`'s milestone gate says not to build ahead of that. Confirmed with the human before
proceeding (multiple-choice: restyle-existing-plus-landing was chosen over building static
mock-ups of the unbuilt pages).

---

## D-018 — Open-source eyes and ears: Qwen3-VL watches the whole run, Whisper transcribes it

**Date:** 2026-07-19 · **By:** Ronit ("use an open source model... we want all the frames") + agent
· **Amends:** D-002 (single-provider), extends D-015

**The three complaints this answers:** video grading felt weak, runs sometimes died on JSON
errors, and the judge never saw the whole video. All three traced to the same design: the judge
saw at most 9 stills (silently trimmed to ≤5 to fit Vercel's 4.5MB body cap next to the audio),
and transcription was a single-shot LLM JSON call that truncated on long runs. The Gemini key is
also low on credit, so "send Gemini the whole video" was ruled out by the human.

**The shape: Gemini stays the judge; open-source models become the senses.**

- **Eyes — Qwen3-VL (235B-A22B) via OpenRouter.** The browser now samples one frame every ~8s
  across the ENTIRE run (up to 60, 640px), posts them to the new `/api/visual` in their own
  request (own body budget — no more fighting the audio), and the vision model writes a
  timestamped, observations-only **visual delivery report** with an explicit `cannot_see` list.
  The judge grades visual criteria from that report. ~1-2¢/run.
- **Ears — Whisper large-v3 via Groq.** A real ASR system: timestamps measured from the audio,
  no JSON to hallucinate, fillers preserved (biased via prompt), ~$0.11/audio-hour vs Gemini's
  3.3× audio token rate. This was D-002's explicitly-kept escape hatch, now real.
- **Judge of last resort.** If Gemini itself returns quota/billing errors, `gemini.ts` reroutes
  that call (text+images only) to the OpenRouter model, loudly logged — a dead key no longer
  hard-fails a student's grade. `RUBRIX_OSS_FALLBACK=off` disables.

**Strictness got TIGHTER, not looser.** Previously `source:"visual"` evidence skipped the §9.7
hallucination check entirely — the judge could invent visual observations. Now, when a report
exists, every visual quote must be verbatim from the report (rendered by the same function that
builds the prompt block, so grounding is honest) or it is stripped and confidence drops. The
calibration wording (rule 4) is untouched. Confidence for visual criteria stays capped at
medium — stills, not motion.

**Graceful degradation, in order:** report (OpenRouter key set) → raw frames to Gemini (no key /
visual call failed — the pre-D-018 path, unchanged) → audio-only (no consent), where visual
criteria stay *not judged*, never zeroed.

**JSON hardening shipped alongside** (all three were real failure modes on long videos):
transcription output no longer duplicates every word (`full_text` is derived in code from the
segments — half the output tokens), transcription gets the same one-retry loop grading has
always had, `gemini.ts` detects `MAX_TOKENS` truncation and retries with a doubled cap instead
of surfacing "unusable JSON", silence now reads as "no intelligible speech" instead of a schema
error, and `json.ts` salvages stray-prose-wrapped objects (but never truncated ones — half a
grade is a wrong grade).

**Privacy:** unchanged from D-015. The video file never leaves the device; the same opt-in
stills now go to OpenRouter instead of Google; audio goes to Groq instead of Google when its key
is set. Neither provider stores them, nothing is persisted, and the consent copy says what
actually happens.

**Cost per graded video run, after:** Whisper ~0.03¢ + visual report ~1-2¢ + Gemini judging
~3-4¢ ≈ **5¢** — and the expensive audio modality is off the Gemini key entirely.

**Prompts:** grading g-1.4.0 (rule 5 split: report-grounded branch + raw-frames branch),
transcribe t-1.1.0 (segments only), new visual v-1.0.0 (observer, not judge). ⚠️ Per the §0
rule these bumps require an eval run; no `GEMINI_API_KEY` was available in this session, so the
eval is **pending** — run `npm run eval` before trusting the change. Recorded honestly in
`docs/prompt-changelog.md`.

---

## D-019 — Timestamps computed in code · pre-submission materials · video default ON

**Date:** 2026-07-19 · **By:** Ronit (explicit, all three) + agent · **Amends:** D-015 (default)

**1. Evidence timestamps are no longer the model's to invent.** Field report: "the times at
which you say the audio is played is completely wrong sometimes." Root cause: `timestamp_start`
on each evidence quote was the one number §9.7 still trusted the model with. But a quote that
survived the grounding check provably EXISTS in the transcript — its position is a fact.
`postValidate` now locates every transcript quote in the segments (`findQuoteStart` in
`grounding.ts`: exact word-sequence match, then the same ≥85% fuzzy bar grounding uses, across
segment boundaries) and **overwrites** the model's timestamp. A quote that isn't in the
recording at all (e.g. from a typed Q&A answer) loses its timestamp — that precision would be
fabricated. Corrections are counted in `validation.timestamps_realigned`. §9.2's principle,
finally applied to the last untrusted number. Pure code change — no prompt bump needed for this
part, and the fix also rides on Whisper's ASR-measured segment times (D-018) rather than
LLM-estimated ones.

**2. Prejudged events can now submit their pre-submission.** Some events require materials
before competition — a report, business plan, portfolio — and their rating sheets score that
document. Those criteria used to be permanently not-assessable in the web app. Now: an optional
"Pre-submission materials" card accepts a PDF (or txt/md); `/api/presubmission` extracts the
text (pdf-parse, in deps since D-014) and hands it straight back — **nothing stored**; the text
rides in the grade request, joins the §9.7 grounding corpus (so source-"document" quotes are
checked verbatim, same as everything else), and document criteria get scored for real. The CLI
grows `--materials <file>`. Notes on shape: text-not-intact-PDF is deliberate — the grade
request already carries audio near the 4.5MB body cap, a report is prose (D-014's intact-PDF
rule was about rating-sheet TABLES), and opaque PDFs would make document quotes ungroundable.
The card shows for every event rather than a per-event flag, because the catalog doesn't record
which events are prejudged and guessing at org rules is forbidden (CLAUDE.md) — modality
honesty already handles both directions. Materials-only grading is allowed (grade the report
before you've recorded anything). Prompt bump: **g-1.5.0** (INPUTS names prejudged materials;
rule 5 gains the branch).

**3. "Let the judge see the run" now defaults ON.** D-015 made visual grading opt-in,
default-off. The human has now explicitly flipped the default: the checkbox is pre-checked and
the student *unchecks* to grade audio-only. Everything else D-015 promised is intact — the
video file never leaves the device, stills are sampled in the browser, used once, never stored,
and the consent copy still states exactly what happens. This is a default change, not a consent
removal: the control remains, in the same place, before anything records.

⚠️ g-1.5.0 requires an eval run (§0); still blocked on a local `GEMINI_API_KEY`, so still
**pending** — same status as D-018's bumps, tracked in `docs/prompt-changelog.md`.

---

## D-020 — Richer, time-aware feedback + the full-report PDF export

**Date:** 2026-07-20 · **By:** Ronit (explicit: "add more to the feedback… consider how much
time they have and what they should cut… add a full export button") + agent

**Three additions to the grading contract (prompt g-1.6.0):**

1. **Time coaching.** When a recording AND a time limit exist, the judge now returns
   `time_coaching`: a coach-voice note, and — when the run is over — 2-5 **cuts**: the
   passages earning the least rubric credit. The strictness split is the point:
   - The model picks WHAT to cut (judgment). Every cut's `quote` must be **verbatim from the
     transcript** — grounded with the same ≥85% check as evidence; an invented cut is
     discarded and counted (`validation.time_cuts_stripped`).
   - Code computes the NUMBERS: `verdict` (over / fits / under-with-room, where "under" means
     >15% of the limit unused — a coaching heuristic, not an org rule; official under-time
     penalties are still never invented, D-005) is recomputed from the measured duration, and
     each cut's `seconds_saved` is word count ÷ the speaker's **measured** WPM. The model was
     told not to estimate time, and isn't trusted to.
   When the run is well under, the judge proposes 1-4 **additions**, each tied to a weak
   criterion. When it fits, just the note.

2. **`what_worked` per criterion.** The strongest genuine moment, quoted where possible —
   with explicit permission to say "nothing here rose above baseline," because invented
   praise is calibration rot. "Not assessable." for unassessable criteria.

3. **`next_run_plan`.** 3-6 ordered, imperative, run-specific steps blending the biggest
   point gaps with the time plan (cuts free up seconds; the plan says where they go).

**The PDF export.** A new "Export full report (PDF)" button on the report screen posts the
run back to `/api/export` (no DB yet — the browser holds the only copy), which Zod-verifies
the shape and renders a deterministic PDF via **pdf-lib** (pure JS — the deployment target
can't run a headless browser, same constraint as D-019's text extraction). The PDF carries
everything: score/tier/bar, the not-judged note, delivery metrics, the judge's note, time
plan, next-run plan, priorities, every criterion with its verbatim evidence and
improvements, the full Q&A with answer points, the complete transcript, honesty notes
(stripped quotes, corrected timestamps, model/prompt/cost), and the non-affiliation
disclaimer on **every page** (§20 requires it on every grade report). Standard-font WinAnsi
encoding means text is sanitized to Latin-1 — a visible '?' beats a crashed export.
Nothing is stored server-side.

⚠️ g-1.6.0 requires an eval run (§0); still blocked on a local `GEMINI_API_KEY` — same
pending status as g-1.4.0/g-1.5.0. The new post-validation stage is unit-tested (grounded
cut kept with computed seconds, invented cut stripped, verdict overwritten, coaching deleted
when no limit exists).

---

## D-021 — Materials card only for prejudged events · a frames failure never kills a run

**Date:** 2026-07-20 · **By:** Ronit (both explicit) + agent · **Amends:** D-019's
show-for-every-event choice

**1. The pre-submission card now appears only on events that actually have one.** D-019
showed it everywhere because the catalog didn't record which events are prejudged and
guessing FBLA rules is forbidden. The fix follows D-012's doctrine exactly: **the guidelines
PDFs say it themselves** — FBLA's own wording contains "prejudged" for the events that
require materials — so `build-catalog.mts` now extracts a `prejudged` boolean from each
PDF's text, and the UI gates the card on `prejudged === true`. The schema accepts old
catalogs (`prejudged: null` = unknown = hidden). ⚠️ **The PDFs are gitignored and absent
from this clone, so `catalog.json` could NOT be regenerated here** — until a human runs
`npm run catalog` from the copy that has the 44 PDFs and commits the result, the card is
hidden for every event. One command, then commit `rubrics/catalog.json`.

**2a. (Superseded by D-022 the same day.)** D-021's PDF-wording extraction for the
prejudged flag was replaced hours later when Ronit supplied FBLA's official list — see
D-022. The PDF wording survives only as a cross-check warning.

**2. Frame extraction is no longer fatal.** Field report: *"video reading isn't working
anymore — (video "loadedmetadata" timed out)"*. Root cause chain: D-019 flipped video
analysis to default-ON, so every upload now passes through the browser's `<video>` element
— including formats it cannot decode (HEVC `.mov` on Windows Chrome is the classic), even
though ffmpeg.wasm had already extracted the audio perfectly. The `<video>` element never
fires `loadedmetadata`, the 15s timer trips, and the shared try/catch killed the WHOLE run.
That violated the ladder rule (a new feature's bottom rung is always "what worked before
still works"). Fixes: frame extraction wrapped in its own catch — on any failure the run
proceeds audio-only (visual criteria honestly "not judged") with a console warning; the
`<video>` element's `error` event now rejects immediately with the real decode reason
instead of hanging to the timeout; and `resolveDuration`'s webm-duration workaround got a
timeout so it can no longer hang forever.

---

## D-022 — The official prejudged list · "no receipts, no high marks" · more feedback

**Date:** 2026-07-20 · **By:** Ronit (all three explicit) + agent · **Amends:** D-021's
extraction approach

**1. The prejudged flag now comes from FBLA's official event list, supplied by the human**
(the D-004 pattern: humans supply org facts; the agent never guesses). Nine catalog events
carry `prejudged: true`: community-service-project, local-chapter-annual-business-report,
business-ethics, business-plan, coding-and-programming, digital-video-production,
future-business-educator, future-business-leader, job-interview. The list is baked into
`build-catalog.mts` as the authority (PDF wording demoted to a cross-check that only
warns); `catalog.json` was patched directly since the PDFs aren't in this clone. Three
events on the official list have no PDF/slug in the catalog and are noted in the script
for whenever their PDFs arrive: american-enterprise-project, partnership-with-business-
project, client-service. **Open question flagged to the human:** website-coding-and-
development is NOT on the supplied list, though D-008 treats its website as a prejudged
component — its materials card is now hidden; the CLI `--site` path is unaffected. FBLA
revises events annually; re-verify the list against the current-year guidelines.

**Guard added after a real incident:** `npm run catalog` run from a clone WITHOUT the
gitignored PDFs overwrote `catalog.json` with an empty catalog (recovered via git). The
script now refuses to write when it finds zero PDFs.

**2. Stricter grading (prompt g-1.7.0), with the strictness in code:** an assessable
criterion with ZERO surviving evidence quotes is capped at half its points in
`postValidate`, AFTER hallucination stripping — so a score propped up by an invented
quote falls with the quote. Tracked as `validation.no_evidence_caps`. The prompt states
the same rule plus: >90% on a criterion requires multiple strong quotes; off-topic
content scores in the criterion's bottom band, not the middle.

**3. More feedback:** improvements per criterion 2-4 → **3-5** (Zod + response schema
minItems, per D-010 — even a strong criterion gets three "what holds this at nationals"
actions), and the summary grows to 4-7 sentences naming the biggest gaps with their point
cost.

⚠️ g-1.7.0 requires an eval run (§0); still blocked on a local `GEMINI_API_KEY`. The
no-evidence cap is unit-tested (inflated evidence-free score capped; fake-quote-backed
score falls after stripping; evidenced scores untouched).

---

## D-023 — Robust frames, confirm-before-grade, presentation-window timing, stricter grading, provider proof

**Date:** 2026-07-20 · **By:** Ronit (all five explicit) + agent

A batch fixing five reported problems on the video path:

**1. Frames via ffmpeg.wasm SEEKING, not the browser `<video>` element.** Field error, still
firing after D-021: `video "loadedmetadata" timed out` → "grading from audio only".
Mechanism: the `<video>` element stalls (no error, no metadata) on large non-faststart mp4
and HEVC .mov. Fix: extract through **ffmpeg.wasm**, the same instance already loaded for
audio, which decodes what the browser can't. Privacy is unchanged (still client-side, still
only stills + audio leave the device).

**⚠️ Correction, same day:** the first cut of this used the `fps=1/8` filter — which forces
ffmpeg to DECODE EVERY frame of the whole video (~18,000 for a 10-min run) to output ~60. In
wasm that is brutally slow and looked frozen with no console output ("it's now doing nothing…
stuck on the video upload thing"). Replaced with per-timestamp **input seeking** (`-ss`
BEFORE `-i`, one `-frames:v 1` exec per sample): it jumps to a keyframe near each target time
and decodes ~one frame, so ~60 quick seeks instead of a full decode. The run length is
estimated from the mp3 size (`AUDIO_BYTES_PER_SEC`, no second decode / no `<video>` read), a
wall-clock budget (55s internal + a 75s race in the caller) guarantees it can never hang —
on timeout it returns the frames gathered so far — and it now logs `[frames] sampling N…` /
`[frames] got N`. The `<video>`+canvas path was removed (it was the hang source and ffmpeg
decodes strictly more). This reverses D-015's "use `<video>` not ffmpeg" note — evidence beat
the prior rationale. ⚠️ **Runtime-unverified here:** ffmpeg.wasm is browser-only, so this is
confirmed by typecheck/build/tests only — needs one real browser upload to confirm speed and
whether our ffmpeg-core has the HEVC video decoder (audio already works because `-vn` never
needed it).

---

## D-024 — Stale-deploy chunk recovery, and a two-decoder frame pipeline that actually produces frames

**Date:** 2026-07-21 · **By:** Ronit (bug reports) + agent

Two field bugs on the same upload flow:

**1. "Failed to load chunk /_next/static/chunks/…js (404)" → the misleading "re-export as
mp4" error.** Mechanism: `processFile` lazy-`import()`s the audio/frames modules; after a
redeploy (my history force-push triggered one) the chunk hashes change, so a tab opened
before the deploy asks for names that no longer exist → 404. It's not a bad file. Fix
(D-024): `loadModule()` retries the dynamic import once (transient blips), a `ChunkLoadError`
is detected and triggers ONE guarded `location.reload()` (sessionStorage key, cleared on a
successful load, so it can't loop but can recover from a future redeploy), the failed state
shows an honest "a new version went live — hard-refresh" message instead of blaming the file,
and a global `error`/`unhandledrejection` listener catches chunk 404s from any other lazy
import. Verified the local build emits its chunks (18 files) — this was purely a deployed-
state mismatch, not a code bug.

**2. `[frames] got 0 frame(s)` — ffmpeg seeked 60 times and produced nothing.** Two causes,
both now handled: (a) a real command bug — single-image output to a fixed filename needs
`-update 1`, without which the image muxer can silently write nothing on EVERY seek, on any
codec; added. (b) the video may be a codec ffmpeg-core can't decode (iPhone HEVC). Fixes:
ffmpeg's own log is now captured and printed to the console when it yields zero frames (so
"why" is visible instead of silent), it bails early after 6 empty seeks, and — the real
robustness win — the browser `<video>`+canvas path is **restored as a fallback**, because the
browser hardware-decodes HEVC on platforms ffmpeg.wasm can't. So: ffmpeg seek → (empty) →
`<video>` decode → (empty) → audio-only, each decoder time-boxed so nothing hangs, each
logging what it got. This reverses the D-023 "removed the `<video>` path" note — removing it
lost the one decoder that reads HEVC. ⚠️ Still browser-only, so verified by
typecheck/build/tests; the next real upload's `[frames]` console lines will show which
decoder wins and, if both fail, ffmpeg's stated reason.

---

## D-025 — "Adherence to competition guidelines" criteria are scored only on what's evidenced

**Date:** 2026-07-21 · **By:** Ronit ("adherence to competition guidelines sometimes doesn't
give right points") + agent · **Prompt:** g-1.9.0

FBLA rating sheets often carry an "Adherence to Competitive Events Guidelines" (or
conduct/attire/compliance) row that BUNDLES things the AI mostly can't see — in-room dress,
proctor instructions, form submission — alongside a few it can (time limit, required
sections). The judge was giving it a middling guess. New rule 5c makes it honest: timing is
code's job (rule 6), format/sections are judged from the site or materials, attire only from
a visual report or frames, and in-room conduct is never guessed. If nothing in the row is
evidenced → `assessable: false` with a reason naming what a real judge checks in the room; if
some is → confidence "low", score only the evidenced part. This is the same modality-honesty
spine as the eye-contact and Q&A rules — no score for evidence that wasn't submitted.

⚠️ g-1.9.0 needs an eval run (§0); still blocked on a local `GEMINI_API_KEY`. It only tightens
an existing not-assessable path (deflationary/honest), so low regression risk, but unmeasured.

---

## D-026 — The frame `-y` bug, the visual 502, readable provider proof, and g-1.10.0

**Date:** 2026-07-21 · **By:** Ronit (a console dump — the best bug report yet) + agent

The user's console pinpointed everything:

**1. `[frames] got 0 frame(s)` was a one-flag bug, not a codec problem.** ffmpeg's own log
(now surfaced, D-024) said `Unrecognized option 'y'` — this emscripten ffmpeg 5.1.4 build
aborts on `-y`. The video was plain **H.264** (the build even has `--enable-libx265`, so HEVC
decodes too — my earlier HEVC worry was unfounded). Removed `-y` (and the unneeded
`-update 1`); it's the canonical single-frame command now. The `<video>` fallback stays for
genuine codec gaps. (The fallback had actually saved this run — it got 60 frames — which then
exposed #2.)

**2. `/api/visual` → 502.** 60 frames in one OpenRouter request is too many (payload/latency).
`MAX_FRAMES` 60 → **24**, plus a defensive `VISION_FRAME_CAP` downsample in `buildVisualReport`,
and the 502 now carries its real reason to the browser console instead of a silent drop to the
Gemini raw-frames path. 24 frames still span the whole run (≈ one per 32s on a 13-min video) —
ample for posture/attire/gesture; the transcript carries content.

**3. "Isn't telling me if it's using all the keys."** The `[providers]` line logged a
collapsed `Object`. Now it prints `transcribe: … · visual: … · judge: …` as text, and a failed
visual call says so loudly ("grading will use raw frames on Gemini instead. Reason: …") — so a
fallback is never silent. (The report footer already shows "heard by / watched by / judged
by".)

**4. Adherence, fixed properly (g-1.10.0).** The user: "time doesn't matter for adherence." Rule
5c now says TIME IS NOT PART OF adherence at all — never raise/lower the row for length. The
presentation-only time (excluding intro and Q&A) is reported entirely separately via the
`presentation_window` timing block (D-023).

**5. Stricter + much more feedback (g-1.10.0).** Rule 4b: start each criterion from "average"
and move off it only for quoted specifics — no comfortable-high default. Improvements 3-5 →
**4-6**, each tied to a named moment. New rule 7c: justifications are **3-5 substantial
sentences** that say why this score not one higher/lower, what a top version would have
contained, and tie to the rubric's own level language — no vague filler.

⚠️ g-1.10.0 needs an eval run (§0); still blocked on a local `GEMINI_API_KEY`. This is the 4th
strictness tightening without measurement — noted honestly: the real generosity signal is the
eval, and repeated blind tightening risks over-correction. The frame/visual/provider fixes are
code and verified by build/tests; their runtime behaviour shows in the next upload's console.

---

## D-027 — Coding & Programming is no longer flagged prejudged (corrects D-022)

**Date:** 2026-07-21 · **By:** Ronit ("coding and programming has a pre submission even though
it doesn't")

D-022's human-supplied list included "Coding & Programming (includes a prejudged program and
project)", so it carried `prejudged: true` and showed the pre-submission card. Correction: its
prejudged component is the CODE/PROGRAM, not a report/plan/portfolio *document* — and the
materials card only accepts a document (PDF/text), so the card is wrong for that event. Removed
`coding-and-programming` from `PREJUDGED_EVENTS` in `build-catalog.mts` and set its
`catalog.json` flag to false (patched directly, since the PDFs are gitignored). Prejudged set is
now 8: business-ethics, business-plan, community-service-project, digital-video-production,
future-business-educator, future-business-leader, job-interview,
local-chapter-annual-business-report. If a code-grading path is ever added (like the `--site`
CLI path), Coding & Programming can get its own submission type then — this only removes the
inapplicable document card.

---

## D-028 — Adherence all-or-nothing rows; the visual 401 was a Vercel env var, not frame count

**Date:** 2026-07-21 · **By:** Ronit (pasted the real adherence rubric + a console dump) + agent

**1. The visual "502" was `OpenRouter 401: Missing Authentication header`** — surfaced by
D-026's error-detail logging. NOT the frame count (my 60→24 cap last turn fixed a non-problem;
kept anyway, 24 still covers the whole run and is a safer request). Root cause is deployment
config: `OPENROUTER_API_KEY` is missing or malformed in Vercel (Groq is set and working — the
run transcribed on `groq/whisper-large-v3`). Added defensive `.trim()` to all three provider
key reads (`hasX()` and the client), because a trailing newline on a pasted Vercel env var
makes the `Authorization: Bearer <key>` header invalid and yields exactly this 401. **User
action, not code:** set a valid `OPENROUTER_API_KEY` in Vercel (the value is in local
`.env.local`). Also outstanding: the deploy is serving a STALE cached `extractFrames` chunk
(still logging `Unrecognized option 'y'`, impossible with current code) — needs a hard refresh
once the latest commit is fully live.

**2. Adherence all-or-nothing rows (prompt g-1.11.0).** Ronit pasted the real "Adherence to
Competitive Events Guidelines" sheet: a 0-or-10, "all criteria must be met" checklist of
in-room protocols (device counts/sizing, set-up conduct, not leaving materials, QR/link
handling, external speakers, food/animals, templates, dress + staff-only penalties). A
recording evidences almost none of it. Rule 5c now handles all-or-nothing rows explicitly:
award full ONLY if every item is confirmable, 0 ONLY on a visible violation, otherwise
`assessable: false` — never a middling guess. The one checkable item (presentation matched the
assigned topic) is noted in the reason but never earns the row alone.

⚠️ g-1.11.0 needs an eval run (§0); still blocked on a local `GEMINI_API_KEY`. It only widens a
not-assessable path (honest, not a scoring change), so near-zero regression risk.

---

## D-029 — Adherence reversed (award it), cost fixed, sample sentences, full-range calibration

**Date:** 2026-07-21 · **By:** Ronit (explicit) + agent · **Amends:** D-028 (adherence)

**1. Cost was understated.** The visual analysis runs in its OWN request (`/api/visual`), so
`/api/grade`'s total (`transcribe + grade + qa`) silently dropped it. The client now folds the
visual `cost_cents` into the run total (~1-2¢ that was missing when the OpenRouter eyes ran).
Every other piece was already summed from each call's own accounting.

**2. Adherence REVERSED (g-1.12.0, amends D-028's "not assessable").** Ronit: "if it can tell,
give those 10 — adherence is the ez 10 points usually." Rule 5c now DEFAULTS to full marks for
adherence/guidelines/protocol rows (assessable true), dropping to 0 only on a SPECIFIC visible
violation (off-topic transcript, visible template, audible external speaker, a rule broken on
camera). No not-assessable, no middling guess — it's the realistic points nearly every
competitor earns, and withholding it just deflated a real score. Time is still never part of it.

**3. Sample sentences (new learning feature, g-1.12.0).** Each criterion below full marks now
carries `sample_lines`: 1-3 example sentences the competitor could actually SAY to raise it,
in their own voice from THIS run's content ("Our 2023 survey of 240 customers found 88% would
buy again…"), ready to rehearse. Rendered in the report ("Try saying") and the PDF; empty for
maxed/not-assessable criteria. Schema + response-schema required (so it always emits, possibly
[]). Not grounded — they are suggestions, not claims about the submission.

**4. Full-range calibration (g-1.12.0 rule 4d).** Scores must SPREAD across the rubric, not
cluster in a high band — if most criteria are 8s/9s, the grader is soft and must re-score the
middling/weak ones down. (Adherence is the one deliberate high exception.) This is the honest
form of "stricter": a believable first-practice result has real variance.

⚠️ g-1.12.0 needs an eval run (§0); still blocked on a local `GEMINI_API_KEY`. Net effect on
scores is mixed (adherence up, full-range spread down) — genuinely unmeasured until the eval
runs, which is now the single most valuable thing outstanding.

---

## D-030 — Visual "terminated" = a slow model hitting the function timeout; and a proven-stale deploy

**Date:** 2026-07-21 · **By:** Ronit (console) + agent

**1. The deploy is running OLD code — proven, not assumed.** The console kept showing the `-y`
ffmpeg error and 5/10 adherence, both fixed in the repo. A fresh local build was greppe: the
client chunks contain the corrected frame command (`force_original_aspect_ratio` present,
`-update`/`-y` gone) and the server bundle contains `g-1.12.0`. So the code and its build are
correct; the deployed app is serving a stale build (the same `2835tx1b_0j7o.js` chunk appears
in three separate console dumps — a file that hasn't changed across "deploys"). **User action:**
confirm Vercel's PRODUCTION deployment is the latest commit (not a pinned old preview URL) and
that its build succeeded, then hard-refresh. Nothing in code can fix a deploy that isn't
updating.

**2. Visual 502 went `401` → `terminated`.** The 401 (missing auth) is resolved — OpenRouter now
authenticates. `terminated` is the connection being killed mid-request, which on a serverless
function means the call outran the function's time limit: the 235B vision model chewing through
24 images is slow. Fixes: the eyes drop to **`qwen/qwen3-vl-32b-instruct`** (describes stills
just as well, returns far faster) and the per-request frame cap drops 24 → **16**. Both are
env-overridable. The judge-of-last-resort stays on the 235B (judging needs the capability and
runs rarely). The Gemini raw-frames fallback remains the floor, so visual grading still happens
either way.

**2. Confirm-before-grade (D-023).** New `confirm` phase: picking or recording a file no
longer starts the pipeline — it stages the file on a screen showing name/size/length and the
visual-grading toggle, and nothing is decoded or uploaded until "Grade this run". Catches the
wrong-file case and a mis-recording.

**3. Presentation-window timing (prompt g-1.8.0).** These recordings run ~7-min presentation +
~3-min (or longer) Q&A in one file, so timing wrongly read "over the 7-min limit." Now the
model marks `presentation_window` = {start_s, end_s, qa_present} from the transcript — start_s
is when the presenter ACTUALLY begins (a host's "you may begin" does NOT start it), end_s is
where judge Q&A begins. Code clamps/snaps those to real segment edges and computes the
PRESENTATION duration; `timing` and `time_coaching` judge that, not the whole recording. Also:
an in-video Q&A now counts as a Q&A session (rule 5b), so question-answering criteria can be
scored from the recording's own Q&A. Delivery metrics still cover the whole recording (the
model is told to read presentation pace from the presentation portion) — a two-pass windowed
recompute was deferred as scope.

**4. Stricter + score-matches-words (g-1.8.0).** Rule 4b (be stingier; reserve the top quarter
for provable competition-winning work) and rule 4c (the score MUST match the justification and
what_worked — a number contradicting its own prose is the most common judge error). Standing
"more strict" order, again.

**5. Provider proof (D-023).** The senses each report which provider actually ran
(`transcribe: groq|gemini`, `visual: openrouter`, `judge: gemini|openrouter`-on-fallback).
`/api/grade` logs key-presence and a per-run `[providers] used:` summary server-side, streams a
`providers` message the browser console prints, and the report footer shows "heard by … ·
watched by … · judged by …" — so it's provable all three keys do work, not that one silently
carried everything.

⚠️ g-1.8.0 requires an eval run (§0); still blocked on a local `GEMINI_API_KEY`. Presentation-
window timing is unit-tested (window drives timing + verdict; snaps to segments; falls back to
whole recording; "you may begin" excluded). Frame extraction and the confirm UX are
verified by typecheck/build/tests but need a real browser upload to confirm end to end.

## D-031 — The deployed build is stamped on screen, so "is it stale?" is a fact

**Date:** 2026-07-22 · **By:** Ronit (asked for it) + agent

The stale-deploy saga (D-030) needed a ground-truth version marker the user could read without
the console. `next.config.ts` already exposes `NEXT_PUBLIC_BUILD_SHA` (Vercel's commit sha, or
`local`); the root layout now renders it as a faded `v·<sha>` fixed in the bottom-right corner of
**every** page. It's server-rendered into the HTML — not a JS chunk — so it reflects exactly what
production is serving and can't be hidden by the stable-chunk-name caching that made D-030 so hard
to diagnose. If that corner shows an old sha after a "deploy", the deploy didn't take. The console
`[build] rubrix <sha>` line stays too.

## D-032 — Adherence is enforced full in code, not just asked for (backs D-029)

**Date:** 2026-07-22 · **By:** Ronit ("give those 10 because adherence is the ez 10 points
usually") + agent

D-029 reversed adherence to *award it by default* via prompt rule 5c (full unless a named,
visible violation → 0; never a middling number; never not-assessable when the format is
observable). But the model kept disobeying — deployed runs, on the correct build, still showed a
hedged **5/10**. An LLM that won't follow an instruction is a signal to stop asking and enforce in
code (Fable: take the pen away from the model). `postValidate()` now snaps any **assessable**
adherence/guidelines row scored strictly between 0 and full up to full, tracked in
`report.adherence_awarded`. Detection is by rubric criterion name
(`/adheren|competitive events guidelines|presentation protocols?/i`).

Two deliberate non-actions, so this doesn't become a loophole in the other direction:
- a **genuine 0** is left as 0 — that's a cited violation, exactly what 5c reserves 0 for;
- a **not-assessable** row is left excluded from the denominator — the "never score what wasn't
  submitted" invariant (a live-protocol rule against a website-only entry) outranks "give the 10".

**Calibration cost, stated honestly:** this raises weak/degenerate runs that still followed the
format — they now bank the full adherence points every time (the eval's weak-ramble and
adversarial-offtopic cases both carry a "Adherence to Competitive Events Guidelines (10)" row and
will rise). That is the exact tradeoff Ronit chose; the eval bands predate it and need widening,
not the enforcement. Mechanism is unit-tested in `postvalidate.test.ts` (middling→full; no-evidence
still→full; genuine 0 preserved; not-assessable never resurrected; non-adherence untouched).
⚠️ The aggregate eval re-run is **PENDING** — deferred to protect the ~$3.6 left on the shared
Gemini key (the deployed app spends it too); the effect above is predictable from the mechanism.

## D-033 — Way more feedback, no repetition, and a per-criterion path to full marks (g-1.13.0)

**Date:** 2026-07-23 · **By:** Ronit ("give way more feedback", "u repeat some times", "help em
get to 100%") + agent

The report repeated itself — `what_worked` and `justification` were saying the same thing ("clearly
identified Flutter and Firebase" in both) — and it never told the student the one thing they most
want: how to get to full marks. Both fixed at the prompt+schema level (g-1.13.0):

1. **Five distinct jobs, no repetition.** Rule 7 now frames the per-criterion feedback as five
   fields each with ONE job the others don't do, with an explicit ban on restating: what_worked
   (one moment) · justification (the score rationale ONLY) · to_full_marks (the target) ·
   improvements (the granular list) · sample_lines (exact words). what_worked is cut to one
   sentence; justification is forbidden from re-describing the moment or listing fixes.
2. **`to_full_marks` — the "get to 100%" field (NEW).** A required per-criterion string: the
   concrete path from this run's score to full marks — opens with the points on the table, then
   exactly what to add/change/cut, tied to the rubric's top level. Rendered as a "Path to full
   marks" callout in the report (`EvidenceLine`) and the PDF (`pdf/report.ts`), placed between the
   rationale and the fix list so the flow reads: best moment → why the score → how to reach full →
   the checklist → what to say. Required in the response schema so it always emits; it's advice,
   not a claim about the submission, so (like sample_lines) it is not grounded.

**Verification:** typecheck + 52 unit tests green (fixtures updated for the new required field);
production build green. ⚠️ Eval PENDING (budget) — but this is additive feedback + de-duplication,
not a scoring-rule change, so calibration is unaffected.

## D-034 — Batched visual analysis + a user "visual detail" choice (more frames, safely)

**Date:** 2026-07-23 · **By:** Ronit ("we want every single detail", "get more frames") + agent

The judge's eyes saw only ~16 stills of a run — one every ~48s on a 13-min file — because the
whole frame set went to the vision model in ONE request, and one request falls over past ~16–24
images (the 502, then the "terminated" timeout of D-026/D-030). So the cap wasn't a quality call;
it was the largest count that didn't crash. Two changes lift it:

1. **Batched vision calls (the real fix).** `analyzeVisual` (client) now splits frames into
   batches of ≤16 and fires one `/api/visual` request per batch, then merges the per-batch reports
   with a new pure `mergeVisualReports()` (observations concatenated + time-ordered; each run-wide
   pattern field unioned so more frames *add* detail; quality/cannot_see deduped). Partial failure
   is tolerated — whatever batches succeed are merged. This removes the single-request wall for
   good: more frames = more small calls, never a crash. `/api/visual` is unchanged (still processes
   one batch); the batching/merge live at the client boundary, which also sidesteps the 4.5MB body
   cap (each batch is its own ~1MB request).
2. **A "Visual detail" choice on the confirm screen** (`thoroughness.ts`): Standard ~16 · Deep ~32
   · Max ~64 frames, with matching extraction density + budget. Higher = finer coverage (every
   slide change, more of each gesture) at the cost of a longer *in-browser* extraction wait — the
   copy says so. `extractFrames`/`samplePlan` are now parameterized by `maxFrames`/`intervalS`; the
   old defaults (24/8s) are preserved so the existing tests hold.

**Cost truth (stated to the user):** frame count scales **OpenRouter** cost (~0.01¢/frame — pennies)
and *not* Gemini — the judge reads the text report, never the frames (except the no-OpenRouter
fallback, where stills go straight to Gemini). Ceiling for now is ~64–70 frames (the fallback
attach still shares the 4.5MB body cap); literal 1-fps would need per-batch fallback uploads too —
parked, not built.

**Verification:** typecheck green; 122 unit tests pass (new: `samplePlan` cap/interval cases in
frames.test.ts, and mergeVisual.test.ts — ordering, pattern union, dedup, schema-valid output);
lint clean; production build green. No prompt change (the visual prompt is untouched), so no eval
is required.

## D-035 — "Max" is now literal 1 frame/second (Ronit asked for every second)

**Date:** 2026-07-23 · **By:** Ronit ("yes 1 frame per second") + agent

Building on D-034's batching, the Max level is now `intervalS: 1` — one frame per second, capped
at 480 (so a ≤8-min run is truly every-second; longer runs spread those 480 to stay under a
few-minute wait), budget 240s. Three things made dense extraction safe:

1. **Coarse-to-fine visiting order (`coverageOrder`, pure + tested).** The extractor no longer
   seeks 0→N in time order; it visits endpoints first, then halves the stride. So when a 480-seek
   pass runs out of its time budget, the frames we DID get still span open to close — not just the
   first 40 seconds (the latent bug that time-ordered iteration would have caused). Frames are
   re-sorted chronologically before use. This improves every level, not just Max.
2. **Bounded client concurrency (5).** Max is ~30 `/api/visual` batches; firing all at once would
   trip OpenRouter's rate limit, so a 5-in-flight pool runs them. Partial failure still merges.
3. **A usable report ceiling in the merge.** ~30 batches can yield hundreds of observations;
   `mergeVisualReports` now evenly downsamples to ≤240 (endpoints kept, so the tail survives) and
   caps each pattern field's union at 16 parts. Thorough but not a wall of text that would bloat
   the judge's input.

Still true from D-034: this scales OpenRouter (pennies), not Gemini (text report). The hard ceiling
is now extraction time + the frame cap, not a crash. Verified: 126 unit tests (new `coverageOrder`
permutation/prefix-spread cases; a dense-merge cap case), typecheck + lint + build green.

**Amendment (2026-07-23, Ronit "up it 660 cap"):** Max cap 480 → **660** frames, extraction budget
240s → **330s** so a dense pass can actually reach it (≈5–5.5 min of in-browser seeking; the race
timeout scales as budget+15s). ~42 batches at concurrency 5; the ≤240-observation merge ceiling is
unchanged, so the report stays usable. Everything else in D-035 holds.

## D-036 — Max returned ZERO frames in production; make extraction never-hang, never-empty, and honest

**Date:** 2026-07-23 · **By:** Ronit (console: "sampling 415 frames … visual: none · ummm what") + agent

A real Max run logged `[frames] ffmpeg: sampling 415 frames` and then graded with `visual: none` —
the judge saw **no video at all**, a strictly worse result than Standard (which gets ~24 stills on
the same file) after a multi-minute wait. Three compounding bugs, all introduced by D-035:

1. **A single ffmpeg.wasm seek could hang with no ceiling.** `await ff.exec(...)` was unbounded;
   one stuck seek (some MediaRecorder `.webm`s seek badly) froze the loop so the internal budget
   check never ran. Fix: each seek is now raced against `PER_SEEK_MS` (12s). ffmpeg.wasm can't be
   cancelled, so on a hung seek we abandon the ffmpeg path entirely and fall through to the
   `<video>` decoder instead of freezing the run.
2. **The outer hard-wall timeout threw away partial work.** It resolved `[]`, discarding every
   frame the extractor had already decoded — so "budget reached" became "zero frames." Fix
   (`onFrame` sink): the extractor now emits each frame as it's decoded; the client collects them
   and, if the wall fires, grades on that coverage-ordered partial (re-sorted chronological) —
   **never `[]`** while any frame exists.
3. **660 / literal-1-fps can't complete in-browser.** Hundreds of sequential seeks overran any
   sane budget on real files. Max is now **150 frames** (intervalS 2, budget 240s) — the most a
   real file reliably decodes in a few minutes, a frame every 2-3s on a typical run (~10× Standard).
   Relabeled "Max detail" (not "every second"), Deep raised 32 → 48. True every-second would
   require **server-side** extraction (uploading the video), which breaks the D-015 privacy promise
   — parked as an explicit user decision, not built.

Still true from D-034/035: frame count scales OpenRouter (pennies), never Gemini (text report).
No prompt change, so no eval required. Verification: typecheck + lint + build + unit tests below.
