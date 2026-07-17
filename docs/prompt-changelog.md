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
