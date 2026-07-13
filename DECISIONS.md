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
