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
