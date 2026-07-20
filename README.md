# Rubrix

**Know your score before the judges do.**

Record a practice run of your CTSO event and get it back scored line by line against the
official rubric — with the exact words that earned each mark, the three fixes worth the most
points, and a judge-style Q&A grill.

Built for FBLA first. 44 events, structured from the official rating sheets.

---

## What it does

```
video/audio  ──▶  audio extracted IN YOUR BROWSER  ──▶  timestamped transcript
                  (transcribed by Whisper large-v3)           │
video (opt-in) ─▶ frames sampled across the WHOLE run ────────┤
                  in your browser, read by Qwen3-VL           │
website URL  ──▶  crawl + screenshots + code facts  ──────────┤
                                                              ▼
                                              rubric-line-by-line score
                                              cited evidence + timestamps
                                              ranked point gaps
                                              judge Q&A → answer it → re-graded
```

- **Record in the browser** or drop in a file.
- **Grade a website** too, for prejudged events — it crawls the real site, screenshots it at
  phone/tablet/desktop sizes, and reads your actual source code.
- **Answer the judge's questions** by typing, dictating, or recording — then those criteria get
  scored for real.

## Run it

```bash
npm install
cp .env.example .env.local        # GEMINI_API_KEY required; GROQ_API_KEY +
                                  # OPENROUTER_API_KEY strongly recommended (D-018)
npm run dev                       # http://localhost:3000
```

One provider per job (see `DECISIONS.md` D-018): **Gemini judges**, open-source models are the
senses — **Whisper large-v3** (via Groq) transcribes, **Qwen3-VL** (via OpenRouter) watches
frames sampled across the whole run and writes a visual delivery report the judge must quote
verbatim. Missing either optional key just degrades that sense to the old Gemini-only path.

CLI, if you prefer:

```bash
npm run judge -- --audio run.mp3 --rubric rubrics/fbla/presentation/public-speaking.rubric.json
npm run judge -- --site ./my-site --rubric rubrics/fbla/presentation/website-coding-and-development.rubric.json
```

Extract audio locally first — **your video never leaves your machine**:

```bash
ffmpeg -i run.mp4 -vn -ac 1 -ar 16000 -b:a 64k run.mp3
```

## The rules this thing is built on

These aren't decoration. They're why the score is worth anything.

**The numbers are computed in code, never by the model.** Words per minute, filler rate, longest
pause, whether the page overflows on a phone, whether your CSS is actually in a separate file,
console errors, alt-text coverage — all measured. The judge is handed the answers and told not to
re-derive them by eye.

**Every quote is verified.** A quote the model attributes to you must actually appear in your
transcript or your source (≥85% fuzzy match). If it doesn't, the quote is stripped and that
criterion's confidence drops a step. A judge that invents a quote is worse than no judge.

**The arithmetic is recomputed in code and overwrites the model.** So is the tier. So are the
ranked point gaps.

**It refuses to bluff.** No recording? Body language and eye contact are *not judged* — not scored
zero. No Q&A? "Answers questions" is *not judged* — and you're invited to answer the questions so
that it can be. You are never marked down for evidence you didn't submit.

**Your video never touches the server.** Audio is extracted in your browser with ffmpeg.wasm. When
you record, the camera is a mirror for you — the recorder is built over an audio-only stream, so
not one frame is captured.

**No rubric grades anyone until a human confirms it.** Machine-parsed rating sheets land in a
review table first, and the API returns 409 for an unreviewed rubric even if called directly.

## Status

Milestone **M1 done** — the grader works end to end.

**Not yet built, and it matters:** the §10 **eval harness**. Until real runs are scored against
real human judges, nobody — including this README — can tell you whether the scores are
*calibrated* or merely *confident*. That is the highest-value thing left to build.
`docs/prompt-changelog.md` tracks an open generosity concern rather than hiding it.

No auth and no database yet (that's M2/M3).

## Rubrics

```
rubrics/{org}/{presentation|roleplay|chapter}/{event}.rubric.json
```

Criterion names and point values are as published on the official rating sheets. **All descriptive
wording is our own** — the sheets are the orgs' intellectual property and are not reproduced here,
nor are the source PDFs. Event categories come from each sheet's own stated "Event Category" line,
not from us guessing at them.

## Read these before changing anything

- [`PLAN.md`](PLAN.md) — the spec.
- [`CLAUDE.md`](CLAUDE.md) — the operating rules.
- [`DECISIONS.md`](DECISIONS.md) — **every place a human amended the spec, and why.** Where it
  disagrees with PLAN.md, it wins.
- [`docs/prompt-changelog.md`](docs/prompt-changelog.md) — every prompt change and its effect.

---

Rubrix is an independent student-built practice tool and is not affiliated with, sponsored by, or
endorsed by FBLA, DECA, TSA, HOSA, or FPSPI. AI practice scores are estimates for preparation only
and do not predict official results.
