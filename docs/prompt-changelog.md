# Prompt changelog

plan.md §0: *"Any wording change bumps `prompt_version`, re-runs `scripts/eval.ts`, and records
results in `docs/prompt-changelog.md`. **Failing eval blocks the change.**"*

Prompts live in `src/lib/ai/prompts.ts`. Never inline one in application code.

> ⚠️ **The eval harness does not exist yet** (`scripts/eval.ts` is milestone **M10**, plan.md §17).
> Until it does, there is nothing to block a bad prompt change. Treat every entry below as
> *unvalidated*. No prompt may be called "good" — and nothing may launch publicly — until it
> clears the §10 bar: Pearson r ≥ 0.8 vs human consensus, |AI − human| ≤ 8 pts, run-to-run
> spread ≤ 3 pts, zero hallucinated quotes after §9.7 stripping, ≥ 80% of fixes judged
> actionable.

---

## g-1.8.0 · grading — 2026-07-20 — presentation window, score-matches-words, in-video Q&A (D-023)

**Why:** three field problems — timing wrongly read "over" because the recording holds
presentation + Q&A in one file; scores sometimes contradicted their own justification; and the
"more strict" standing order.

**Diff from g-1.7.0:**
1. **Rule 6 rewritten → presentation window.** The model fills `presentation_window`
   {start_s, end_s, qa_present} from the transcript: start_s = when the presenter ACTUALLY
   begins ("you may begin" from a host does NOT start it), end_s = where judge Q&A begins (or
   end of recording). Pacing is judged on the presentation, not the Q&A. INPUTS now states the
   recording often contains presentation + Q&A and the delivery metrics cover the whole thing.
2. **Rule 5b extended:** an in-video judge Q&A (presentation_window.qa_present) counts as a
   Q&A session, so question-answering criteria can be scored from the recording itself, not
   only a separately-attached drill.
3. **Rule 4b/4c:** be stingier (reserve the top quarter for provable competition-winning
   work); the score MUST match the justification and what_worked.

**Post-validation riding along (§9.7):** `presentation_window` is clamped and snapped to real
segment edges; `timing` and `time_coaching` verdict are computed from the PRESENTATION
duration, not the whole recording. Falls back to whole-recording timing when the model gives no
window. Unit-tested.

**Not a prompt change but shipped alongside (D-023):** frames now extract via ffmpeg.wasm (the
`<video>` `loadedmetadata` timeout is gone); a confirm-before-grade screen; and provider-usage
reporting (transcribe/visual/judge each say who ran).

**Eval:** ⚠️ **PENDING — still blocked on a local GEMINI_API_KEY.** Watch, when it runs: the
window detection's effect on timing-sensitive cases, and whether 4b/4c push medians down
(intended). No eval case yet exercises a presentation+Q&A recording — worth adding one.

---

## g-1.7.0 · grading — 2026-07-20 — stricter calibration + more feedback (D-022)

**Why:** the human's standing order, made explicit again: "be more strict, more feedback."

**Diff from g-1.6.0:**
1. **Rule 4 tightened:** >90% on a criterion now requires MULTIPLE strong verbatim quotes;
   an assessable criterion without at least one verbatim quote "cannot earn more than HALF
   its points — code enforces this cap, so score it that way yourself"; off-topic content
   scores in the criterion's bottom band, not the middle.
2. **Rule 7:** improvements 2-4 → 3-5 per criterion ("Even a strong criterion gets 3 —
   what would hold this at nationals"). Enforced in the response schema (minItems 3,
   maxItems 5) per D-010 so shortfalls don't burn retries.
3. **Rule 9:** summary 3-5 → 4-7 sentences, now naming the biggest gaps with what each is
   costing in points.

**Post-validation riding along (§9.7):** the "no receipts, no high marks" cap — assessable
criteria with zero SURVIVING evidence quotes capped at 50% of max_points, applied after
hallucination stripping so fake-quote-backed scores fall with their quotes. Tracked as
`validation.no_evidence_caps`. Unit-tested.

**Eval:** ⚠️ **PENDING — still blocked on a local GEMINI_API_KEY.** Note for whoever runs
it first: this bump is deliberately deflationary; expect medians to move DOWN a few points.
The weak-ramble and adversarial cases should drop or hold; if an on-topic baseline falls
OUT of its band, that's the cap being too blunt — look at whether the model simply failed
to quote rather than the submission failing to evidence.

---

## g-1.6.0 · grading — 2026-07-20 — time coaching, what_worked, next_run_plan (D-020)

**Why:** the human asked for more feedback, time-aware coaching ("consider how much time
they have and what they should cut"), and a full PDF export (the export needs no prompt
change; it ships alongside).

**Diff from g-1.5.0** — three additions, everything else untouched:

1. **Rule 6b (time coaching):** only when a recording AND a limit exist. Over the limit →
   2-5 cuts, each quote VERBATIM from the transcript ("it is checked word for word, and an
   invented quote is discarded"), reason tied to the rubric, and — load-bearing — *"Do NOT
   estimate the time a cut saves; code computes that from the quote's length at the
   speaker's measured pace."* Well under → 1-4 additions targeting weak criteria. Fits →
   note only. Verdict stated but recomputed in code either way.
2. **Rule 7b (what_worked):** per criterion, the strongest GENUINE moment — *"Never invent
   praise; the calibration rules apply to praise exactly as they apply to scores"* — with
   plain "nothing stood out" explicitly sanctioned.
3. **Rule 9b (next_run_plan):** 3-6 ordered, imperative, run-specific steps; if cuts were
   proposed, the plan says what to do with the reclaimed time.

**Post-validation riding along (§9.7):** a new time-coaching stage — deleted when no
recording/limit; verdict recomputed from measured duration (over / fits / under at >15%
unused); cut quotes grounded against the transcript (strips counted in
`validation.time_cuts_stripped`); `seconds_saved` computed as words ÷ measured WPM.
Unit-tested without a key.

**Schema:** `what_worked` and `next_run_plan` are REQUIRED (enforced in the Gemini response
schema so absence doesn't burn retries, per D-010); `time_coaching` optional by design.
`seconds_saved` deliberately does not exist in the model-facing schema at all.

**Eval:** ⚠️ **PENDING — still blocked on a local GEMINI_API_KEY** (same status as
g-1.4.0/g-1.5.0 below). New risks the harness should watch when it runs: what_worked
inviting generosity drift (the anchor band check covers it), and cut-quote grounding
survival rates.

---

## g-1.5.0 · grading — 2026-07-19 — pre-submission materials + timestamps recomputed in code (D-019)

**Why:** (a) prejudged events (report/plan/portfolio submitted before competition) had their
document criteria permanently not-assessable in the web app; (b) evidence timestamps were
"completely wrong sometimes" — `timestamp_start` was the one number §9.7 still let the model
invent.

**Diff from g-1.4.0** — two additions, nothing else touched:
1. INPUTS gains a third submission type: PREJUDGED MATERIALS (extracted text of the
   pre-submitted document).
2. Rule 5 gains the branch: materials present → document criteria assessable, quoted verbatim
   with source "document" (grounded against the materials text); materials absent → such
   criteria not assessable, with a not_assessable_reason inviting the upload.

**Post-validation change (§9.7, no prompt involved):** every transcript-sourced quote's
timestamp is now located in the segments in code (`findQuoteStart`) and the model's value is
**overwritten**; quotes not present in the recording lose their timestamp. Tracked as
`validation.timestamps_realigned`. This closes the last number the model was trusted with —
same principle as the D-007 arithmetic overwrite.

**Eval:** ⚠️ **PENDING — still blocked on a local GEMINI_API_KEY** (same status as g-1.4.0
below). The timestamp realignment and materials grounding are unit-tested; calibration impact
of the new materials branch is unmeasured until the harness runs.

---

## g-1.4.0 · grading + t-1.1.0 · transcription + v-1.0.0 · visual — 2026-07-19 — open-source eyes and ears (D-018)

**Why:** three field complaints — video grading felt thin, runs sometimes died on JSON errors,
and the judge never saw the whole video (≤9 stills, silently trimmed to ≤5 by the upload cap).
Plus a hard constraint: the Gemini key is low on credit.

**g-1.4.0 (diff from g-1.3.0)** — rule 5's video branch split in two:

> VISUAL DELIVERY REPORT: if present (a vision system watched frames sampled across the ENTIRE
> run), visual-delivery criteria ARE assessable, confidence "medium" at most. Evidence uses
> source "visual" and the quote MUST be verbatim from the report — it is checked against the
> report exactly like transcript quotes; an invented observation is stripped. Respect the
> report's "cannot see" list.
> RAW VIDEO FRAMES (no report): the g-1.3.0 behaviour, unchanged.

This is a strictness INCREASE: source-"visual" evidence used to skip the §9.7 hallucination
check entirely; with a report present it is now grounded like everything else (postValidate
change, unit-tested). Calibration wording (rule 4) untouched.

**t-1.1.0 (diff from t-1.0.0):** the model returns segments only; `full_text` is derived in
code by joining them. The old shape wrote every word twice and truncated long runs mid-JSON at
the output cap — the main "unusable JSON" source on video uploads. Also: one corrective retry
(same loop grading has), and silence now returns an empty segments array (surfaced as "no
intelligible speech", not a schema failure). When `GROQ_API_KEY` is set this prompt isn't used
at all — Whisper large-v3 on Groq transcribes with ASR-measured timestamps.

**v-1.0.0 (new):** the open-source vision model (Qwen3-VL via OpenRouter) is an OBSERVER, not a
judge — timestamped, strictly-visible observations; per-dimension patterns across the run; an
explicit `cannot_see` list; no identity speculation; temperature 0. Its rendered report is both
the judge's prompt block and the grounding corpus for visual quotes — same function, so honest
quotes always ground.

**Eval:** ⚠️ **PENDING — blocked on a key, not skipped by choice.** No `GEMINI_API_KEY` was
available in this session, so `npm run eval` could not be run. Under §0 this change must not be
called good until the harness passes (and the visual path still has no eval case at all — a
frames-bearing case is the obvious next addition). Mechanics are covered by unit tests
(grounded-visual stripping, derived full_text, truncation repair, sampling plan).

---

## grading temperature 0.2 → 0 — 2026-07-17 (measured by the eval harness)

Not a prompt-text change, so the version stays g-1.3.0 — but a material grading change, logged
here per §0.

The eval harness (§10, now built) measured **run-to-run spread** — the same input graded 3× with
different seeds — and found it was terrible at the spec's `temperature: 0.2`:

| temperature | raw score across 3 runs (same input) | spread |
|---|---|---|
| 0.2 | 42, 64, 54 | **22 pts** |
| 0   | 46, 46, 42 | **4 pts** |

A grader that gives 42 one run and 64 the next on the *same* recording is not trustworthy. §9.5
allows 0–0.2; **0 is now used.** It roughly quarters the variance and makes a re-grade reproducible.

Residual spread at temp 0 is still ~4–6pt on normal cases (and much larger on degenerate near-empty
inputs, where a tiny raw difference is a big %) — over §10's ≤3pt bar. Closing that needs §9.7's
**3-run median in the production path** (currently a single grade; the median is marked Phase 1.5).
The harness now proves that step is required, not optional.

**Side effect the harness caught:** at 0.2 the weak-ramble case scored a too-generous 53% median;
at 0 it lands at 17% — in its expected needs_work band. Lower temperature fixed a real generosity
problem, exactly the §1 failure mode.

---

## eval harness — 2026-07-17 (M10, the ship gate — now exists)

`scripts/eval.ts` + `scripts/eval-cases/`. Runs each case 3× (varied seeds, to measure real
spread), prints the §10 table (pct · in-band · tier · hallucination · must_mention · spread ·
cost), gates, and writes `docs/eval-results/{date}-{prompt_version}.{md,json}`.

**Two gates, honestly separated:**
- **Invariants (runs today, no humans):** median in band, no hallucinated quote survives §9.7
  stripping, no regression vs the previous run, no case errored. First run: **✅ PASS**.
- **Calibration (needs human-judged cases):** Pearson r ≥ 0.8 vs human consensus, |AI−human| ≤ 8.
  **⏳ PENDING — 0 cases carry human scores.** The math is built and lights up the moment a
  case's `human.total` is filled. Human labels are NEVER fabricated — an invented score would
  defeat the entire harness.

Seed cases (machine-checkable, honestly labeled): `adversarial-offtopic` (food-waste speech vs the
Sales rubric → must score very low, invent nothing), `weak-ramble` (contentless filler →
needs_work), and two on-topic baselines. Their bands are author estimates, not human consensus —
which is exactly why the calibration gate stays pending. Still missing from §10's minimum set: a
strong nationals-quality run and a DECA written entry, both of which need real artifacts.

**What a passing invariant gate does NOT mean:** that the scores are accurate. Accuracy is the
calibration gate, still pending human data. The harness turns "the grader feels maybe generous"
into a number (weak-ramble 17% ✓, adversarial 33% ✓) — but "does 75% match a real judge?" is
unanswerable until the golden set exists.

---

## g-1.3.0 · grading — 2026-07-13 — the judge gets eyes (opt-in video frames)

**Why:** audio-only grading left every visual-delivery criterion *not judged*, deflating scores on
presentation events. Ronit asked for visual grading; DECISIONS D-015 records the privacy decision.

**Diff from g-1.2.0** — rule 5 (modality honesty) gained a video-frames branch:

> VIDEO FRAMES: if still frames from the presentation are attached, then criteria about visual
> delivery — posture, body language, eye contact, gestures, facial expression, appearance/attire,
> and any visual aids held up — ARE assessable. Judge them from the frames at confidence "medium"
> (stills, not motion — you see a moment, not movement). Put observations in "justification"; cite
> a frame with an evidence item of source "visual". Judge only what the frames actually show — do
> not infer eye contact you cannot see.

The not-assessable rule is unchanged when there are **no** frames: visual criteria stay *not
judged*, never zeroed.

**Mechanics:** frames are sampled in the browser (video file never uploaded), sent as image parts
exactly like the website screenshots already are. `source: "visual"` evidence skips the transcript
hallucination check (unit-tested). Confidence pinned to medium so the report stays honest that
these are stills.

**Eval:** none. M10 still not built. Whether frame-based visual scoring is *accurate* — vs the
model over-reading a single still — is exactly the kind of thing the eval harness must measure, and
is now a third reason it's the top priority.

---

## g-1.2.0 · grading — 2026-07-13 — **closes the `assessable` instability**

**Why:** the bug below. The model flip-flopped on whether a question-answering criterion was
"not evidenced" or "scored 0", swinging the result ~11 points and a whole tier between runs.

**The product decision (Ronit):** *don't grade it if there's no Q&A — ask the questions instead.*

**Diff from g-1.1.0** — one new rule, `5b`, written to be applied mechanically rather than
judged:

> Some criteria can ONLY be evidenced by the competitor answering a judge's questions.
> - If the submission contains **NO Q&A SESSION**, such a criterion is **ALWAYS**
>   `"assessable": false`. Never score it. Never write 0 as if they failed. The student was
>   not asked anything, so they cannot have answered badly.
> - If a Q&A SESSION **is** present, the criterion is `"assessable": true` — judge it from the
>   student's actual answers, and quote them.
> - "This is not a close call and must not vary between runs. Absent Q&A = not assessable,
>   every single time."

The ambiguity that let the model choose is gone: the condition is now a fact about the
submission (is there a Q&A session, yes/no), not a judgement call.

**The product change that makes this honest:** excluding the points isn't enough — the student
still can't earn them. So the app now runs a **Q&A drill**: the judge's generated questions are
put to the student, who answers by typing, dictating (Web Speech API, on-device), or recording
audio (transcribed server-side). Those answers are attached to the submission (`Submission.qa`),
the grader re-runs, and the criterion is scored for real. The answers also join the grounding
corpus, so quotes from them aren't stripped as hallucinations.

**Observed on the first run:** before answering, "Demonstrates the ability to effectively answer
questions" was correctly *not judged* (denominator 90 of 110). After answering, it became
assessable and scored — and because the test filled every box with the same canned paragraph,
the judge gave it **0/10** and said so: *"the exact same, largely irrelevant, canned response to
every single question."* It caught the cheat rather than rewarding volume.

Two criteria stayed correctly unjudgeable (body language — needs video; competitive-events
protocol — judged in the room).

**Eval:** none. M10 still not built. The rule is now *deterministic by construction*, which is
a stronger guarantee than a tuned prompt — but "the spread closed" remains **unmeasured** until
the eval harness exists.

---

## ⚠️ `assessable` FLAG IS UNSTABLE — RESOLVED by g-1.2.0 (kept for the record), 2026-07-13

Two runs of the **same audio** against the **same rubric** handled the same criterion
("Demonstrates the ability to effectively answer questions", 10 pts) two different ways:

| run | how it treated the criterion | score |
|---|---|---|
| A | `assessable: false` — excluded from the denominator | **80/90 → 88.9%, Nationals-ready** |
| B | `assessable: true`, scored **0** — kept in the denominator | **78/100 → 78.0%, State-ready** |

**One flag flip moved the result ~11 percentage points and a whole tier.** That is far outside
§10's ship bar (run-to-run spread ≤ 3 pts).

Both readings are arguable — the recording contained no Q&A, so you can call that *"not
evidenced by this submission"* (exclude) or *"did not demonstrate it"* (score 0). The prompt
(g-1.1.0 rule 5) does not say which, and the model picks differently on different runs. The
inputs weren't byte-identical either (run B's audio went through ffmpeg.wasm → mp3; run A read
the WAV directly), so this is not purely model nondeterminism — but the ambiguity is real and
the prompt is the thing that should resolve it.

**Do not fix this by nudging the prompt until the number looks nice.** Decide the *product*
question first — if the event's rubric expects Q&A and the student didn't record any, is that a
zero or an omission? — then encode the answer explicitly in rule 5, and let the eval harness
(M10) confirm the spread closes. This is precisely the class of instability §10 exists to catch,
and it is a second, independent reason the eval harness is now the highest-value thing unbuilt.

---

## ⚠️ GENEROSITY WATCH — open concern, 2026-07-12

plan.md §9.7 requires a **generosity monitor**: *"rolling median first-attempt score per event.
If it drifts above the anchor band (55-85% for typical first runs), tighten prompts."*

**First Sales Presentation run scored 80/90 = 88.9% → `competitive_national` ("Nationals-ready").
That is above the anchor band, on a first attempt, from a flat text-to-speech reading.**

It handed out **five 10/10s**. The grading prompt (rule 4) says plainly: *"Award >90% on a
criterion only when it would impress a veteran judge; award full marks on the overall total
essentially never."* Five perfect marks on a monotone synthetic voice is not that.

Mitigating: the test pitch was *written* to tick every criterion (greeting → needs → product →
objection → suggestion sell → close → relationship), so a high score is not absurd. It is one
data point, and the sample is synthetic.

**This is not resolvable by argument — it is exactly what the §10 eval harness is for.** Until
M10 exists there is no way to know whether the judge is calibrated or flattering, and *a
generous judge is the single failure mode that kills this product* (§1: "generosity-biased
scores are worse than none"). Do not tune the prompt on vibes. Build the eval set, score real
runs against human judges, and let the number decide.

Tracking here so it is not quietly forgotten.

---

## g-1.1.0 · grading — 2026-07-12

**Why:** the launch event (FBLA Website Coding & Development) is a *prejudged* event — the thing
being graded is a **website**, not a speech. g-1.0.0 could only read a transcript, so 12 of that
sheet's 16 criteria were unjudgeable.

**Diff from g-1.0.0** — three changes, everything else is still §9.5 verbatim:

1. `INPUTS` now names both submission types (website: source code + rendered screenshots +
   computed site facts; presentation: transcript + delivery metrics), and states that anything
   not listed under `SUBMISSION CONTENTS` is simply absent.
2. **Rule 5 (modality honesty) now cuts both ways**, and gained an `assessable` flag on each
   criterion. Previously it only handled "visual criterion, audio-only submission". It now also
   handles "delivery criterion, website-only submission" — and the model must declare the
   criterion *not assessable* rather than quietly scoring it zero. This is the difference between
   telling a student *"you failed the delivery section"* and *"you didn't submit a recording."*
3. Rule 6 (timing) is skipped when no recording was submitted.

**Post-validation change (§9.7):** the tier is now computed off the **assessable** percentage.
Without this, a website-only entry against a 220-point sheet that also scores live delivery would
score 118/220 and always read `needs_work` — punishing the student for what they didn't send. It
now reports 118/**180** and says plainly which 40 points weren't judged.

**Eval:** none. M10 not built. **This change is therefore UNVALIDATED against the §10 bar** —
under the rules in §0 a failing eval would block it, but there is no eval to fail yet. Treat the
scores as directionally useful and not yet trustworthy.

**First observed run** (real FBLA Website rubric, sample site with 5 deliberately planted flaws):
- Caught all five: inline `<style>` block, missing `alt`, a 1400px table overflowing on mobile,
  a JS `TypeError`, and a nav missing a link on one page. Each quoted with the offending line.
- Correctly declared the 4 delivery/protocol criteria not assessable (40 pts).
- Post-validation caught the model overstating its own total (claimed 120, real sum 118),
  stripped 2 hallucinated quotes, and overwrote the tier.
- One schema retry was needed (doubles cost/latency) — now logged with its Zod issues so the
  cause can be found rather than guessed at.

---

## g-1.0.0 · grading — 2026-07-12

Initial. Copied **verbatim** from plan.md §9.5. Placeholders `{{ORG}}`, `{{EVENT_NAME}}`,
`{{SCORE_ANCHORS}}`, `{{TIME_LIMIT}}`, `{{ACTUAL_DURATION}}` are filled server-side.

- `temperature: 0.2`, `seed: 7`, `thinkingBudget: 4096`
- Schema enforced server-side via `responseSchema`; §9.7 post-validation runs on top regardless.

**Eval:** none. M10 not built.

**First observed run** (dev placeholder rubric, 54s TTS speech with seeded fillers):
52/100 → `needs_work`. That is *below* the 55–85% anchor band for a first practice run, i.e.
the judge is currently **stingy rather than generous** — the safe direction to be wrong in, and
the opposite of the raw-ChatGPT failure mode this product exists to beat. Worth watching once
the generosity monitor (§9.7) has real data. One data point is not a calibration.

---

## g-1.0.0 · Q&A — 2026-07-12

Initial. Verbatim from plan.md §9.6. `temperature: 0.7` (deliberately higher than grading:
scores must be reproducible, questions should feel like a real judge).

**First observed run:** 12 questions, correctly attacking the weakest spots — including
demanding a source for a headline statistic the speaker never sourced. Behaves as specified.

**Eval:** none. M10 not built. §17 M9's "≥ half targeting sub-85% criteria" is now *measured*
(`qa.weakSpotCoverage` in `run.json`) but not yet *enforced*.

---

## r-1.0.0 · rubric parse — 2026-07-12

Initial. Verbatim from plan.md §9.4. **Not yet exercised** — rubric upload/parse is F3 /
milestone M6. M1 loads rubric JSON straight off disk.

---

## t-1.0.0 · transcription — 2026-07-12

**New prompt with no counterpart in plan.md.** §9.1 specified OpenAI Whisper, which needs no
prompt. Transcription moved to Gemini (DECISIONS.md D-002), so it needs one.

Design notes, both load-bearing:
- It demands **verbatim** output and explicitly orders the model to *keep* disfluencies
  ("um", "uh", false starts). §9.2's filler metrics are computed from this text — a model that
  helpfully cleans up the transcript would silently zero out the filler count.
- It forbids inventing words to fill silence.
- `temperature: 0`, `thinkingBudget: 0` (nothing to deliberate about; thought tokens bill at the
  output rate).

**First observed run:** verbatim fidelity confirmed against a known script — all 6 seeded
fillers preserved. 14 segments, monotonic, non-overlapping, final segment ended 53.3s against a
true 54.01s duration.

**Eval:** none.
