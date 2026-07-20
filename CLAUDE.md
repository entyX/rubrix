# RUBRIX — CLAUDE.md (Agent Operating Manual)

You are building RUBRIX, an AI-graded competition workspace for high school CTSO students (FBLA, DECA, HOSA, TSA). The full specification is in `PLAN.md`. This file is your constitution. Read it first. Follow it always.

**Read `DECISIONS.md` too.** It records every place a human has amended the spec. Where DECISIONS.md and PLAN.md disagree, DECISIONS.md is newer and wins. The two amendments you will trip over immediately:
- The product is **Rubrix**, not Podium (D-001).
- The AI provider is **Google Gemini** (`gemini-2.5-flash`), not Anthropic + OpenAI Whisper (D-002). One key: `GEMINI_API_KEY`.

---

## CORE OPERATING RULES

**Source of truth:** `plan.md` is the single source of truth. When in doubt, read the relevant section. Never invent product behavior that isn't in the spec.

**Build order:** Build milestones in §17 order (M1 → M13). Never start M(n+1) until M(n)'s acceptance criteria pass locally and are verified by a human.

**The grader is the product:** When prioritization is ambiguous, grading quality and grading UX win. Everything else is retention. If the AI judge feels fake, generous, or unreliable, the product is dead.

**Ship vertical slices:** Every work session ends with something runnable end-to-end, even if ugly. No half-finished features. No "I'll wire it up later."

**Scope is law:** New ideas go in `later.md`, not the sprint. If it's not in `plan.md` §4 (Feature Scope), you don't build it this week.

**Stop and ask a human when:**
- A product decision isn't in the spec
- A dependency conflicts
- An official event/rubric question arises
- An acceptance criteria can't be met as written
- You're about to spend >2 hours stuck

Do not invent product behavior. Do not guess at FBLA rules. Do not make up rubric criteria.

---

## TECHNICAL CONSTRAINTS

**TypeScript strict mode.** No `any` types. No `@ts-ignore`. If you can't type it, refactor it.

**Zod-validate every boundary:**
- Every API request body
- Every LLM JSON output
- Every database query result that touches the UI

**Server components by default.** Client components (`'use client'`) only where interaction demands it (drag-and-drop, forms, real-time updates).

**Prompts are code.** Prompts live in `src/lib/ai/prompts.ts` with version headers. Never hardcode prompts inline in application code. Any wording change:
1. Bumps `prompt_version`
2. Re-runs `scripts/eval.ts`
3. Records results in `docs/prompt-changelog.md`
4. Failing eval blocks the change

**Rubrics are structured, never republished.** Rubric JSONs are paraphrased/restructured from official sheets. Store `source_url` links only. Never republish rubric PDFs/text wholesale. Non-affiliation disclaimer (§20) in the footer and on every grade report.

**Every table gets RLS before it gets UI.** If you create a table, write its policies in the same migration. Never expose `SUPABASE_SERVICE_ROLE_KEY` or `GEMINI_API_KEY` client-side. AI + service-role logic lives in `/api` routes and `src/lib/server` modules only.

---

## PRIVACY & LEGAL (NON-NEGOTIABLE)

**Minimum age 13 enforced at signup.** No exceptions. No "I'll add it later." The checkbox is required.

**Original video never stored.** Audio only (mp3), extracted client-side via `ffmpeg.wasm`. The video file never touches our servers.

**Raw assets auto-purge at 90 days.** Transcripts and scores are retained; original audio is deleted.

**Student data never used for training without explicit consent.** This is a hard legal requirement.

**Every query scoped to the workspace/chapter.** RLS enforces this. A user in Chapter A cannot see Chapter B's data. Period.

**Non-affiliation disclaimer on every grade report:**
> "Rubrix is an independent student-built practice tool and is not affiliated with, sponsored by, or endorsed by FBLA, DECA, TSA, HOSA, or FPSPI. AI practice scores are estimates for preparation only and do not predict official results."

---

## AI/LLM SPECIFIC RULES

**Provider: Google Gemini (`gemini-2.5-flash`) is THE JUDGE.** Grading, Q&A, rubric parsing (D-002).
The senses are open-source when their keys exist (D-018): transcription = Whisper large-v3 via
Groq (`GROQ_API_KEY`), whole-run visual analysis = Qwen3-VL via OpenRouter (`OPENROUTER_API_KEY`),
each degrading to the Gemini-only path without its key. Never move JUDGING off Gemini silently —
the only sanctioned exception is the loudly-logged quota-death fallback in `gemini.ts`
(`RUBRIX_OSS_FALLBACK=off` disables). Two Gemini traps, both verified the hard way:
- Use `ai.models.generateContent(...)` with `responseMimeType: 'application/json'` + `responseSchema`. **Do NOT use the newer `ai.interactions.create(...)`** — on 2.5-flash it *silently ignores* `response_format` and returns prose. A silently-unenforced schema in a grader fails as a wrong score, not as an error (D-003).
- `thinkingLevel` 400s on 2.5-flash. Use the numeric `thinkingBudget` (0 = off). Thought tokens bill at the **output** rate, so it is a real cost lever.

**Cost discipline:** Target ≤ $0.30 average per graded run. Log `token_usage` + `cost_cents` per run to the `gradings` table. Console-warn if any single grade exceeds $0.75. Audio input bills at 3.3× text ($1.00 vs $0.30 per 1M), so transcription is the cost driver — pricing constants live in `src/lib/ai/models.ts` with their source URL.

**Temperature 0–0.2 for grading.** We want deterministic, evidence-based scores, not creative variation. Gemini also exposes `seed` — set it, for reproducible reruns (§9.7 consistency).

**Eval harness is the ship gate.** No public launch without passing §10 eval protocol:
- Total-score Pearson r ≥ 0.8 vs human consensus
- |AI − human| ≤ 8 pts on total
- Run-to-run spread ≤ 3 pts
- Zero hallucinated quotes after §9.7 stripping
- ≥ 80% of "fix" fields judged actionable by humans

**Hallucination check is non-negotiable.** Every transcript-sourced `evidence.quote` must be a substring of `transcript.full_text` (whitespace/case-normalized, ≥ 85% fuzzy match). Any failure → strip the quote and drop that criterion's confidence one step.

**Generosity monitor:** Rolling median first-attempt score per event. If it drifts above the anchor band (55-85% for typical first runs), tighten prompts.

**Modality honesty:** If a criterion targets visuals/design/appearance and we only have an audio transcript, set `confidence: "low"`, explain in `not_assessable_reason`, and score only what is verbally evidenced. Never guess.

---

## DESIGN & UX RULES

**Design compliance:** Every UI uses the tokens and rules in `plan.md` §11 (Design System). Screenshot every new screen and self-critique against §11 before marking a task done.

**Performance floor:** LCP < 2.5s, CLS < 0.05. Animate only `transform`/`opacity`. Fonts system-first. Fully responsive to 360px. Visible keyboard focus. `prefers-reduced-motion` respected.

**Empty states:** Every async view ships a skeleton + an empty state. Copy in `plan.md` §15. Never show a blank page.

**Error messages:** Friendly, specific, second-person. Never raw error strings. Copy deck in `plan.md` §15.

**Voice:** Coach-like, concrete, zero "AI magic ✨", no emoji in product UI, sentence case. Direct and respectful. Never shame ("Needs work" is the floor, not an insult).

---

## QUALITY GATES

**Unit tests (Vitest):** Rubric Zod schemas, grading post-validation (coverage repair, arithmetic overwrite, hallucination stripping), task templates (counts per format, clamping, ordering), usage counting, transcript formatter, checklist auto-flag logic, rate limiter.

**Integration/E2E (Playwright):** Signup → dashboard, wizard creates workspace with correct back-scheduled tasks, task drag persists + survives reload, rubric upload → review edit → save, full grading run renders report with all tabs, invite-link accept, RLS smoke test (user B cannot fetch user A's workspace).

**Manual QA (run fully in launch-prep week):** New-user flow on desktop + phone, size-cap rejection, wrong file type, scanned-PDF rejection, team-full join, wrong invite code, grade without confirmed rubric (blocked), over-limit grading (429), officer dashboard as member (403), recordings-sharing toggle gates playback, account deletion cascades.

**AI regression:** Rerun the §10 eval set on ANY change to prompt, model string, or post-validation. Commit results per `prompt_version` to `docs/eval-results/`.

---

## FILE STRUCTURE

As of **M1 (grader proven end-to-end)**. Target layout is PLAN.md §6.

```
PLAN.md              # the spec (amended — see the banner at its top)
CLAUDE.md            # this file. the constitution.
DECISIONS.md         # every human amendment to the spec. read it.
later.md             # parked ideas. scope is law.
docs/
  prompt-changelog.md    # every prompt change + its eval result
  eval-results/          # empty until M10
rubrics/
  README.md              # ⚠️ what a HUMAN must supply. no real rubrics exist yet.
  _dev-generic-speech.rubric.json   # INVENTED placeholder. not FBLA's. meaningless scores.
scripts/
  pipeline.ts        # the judge, end to end.  `npm run judge -- --site <url|dir> [--audio f]`
src/lib/
  ai/
    prompts.ts       # PROMPTS ARE CODE. versioned. never inline one elsewhere.
    schemas.ts       # Zod (§9.3) + the Gemini responseSchemas
    models.ts        # model ids + pricing constants (with source URLs) + cost math
    gemini.ts        # the ONLY module importing the Gemini SDK. timeout/retry/usage logging.
    openrouter.ts    # the ONLY module talking to OpenRouter (Qwen3-VL, D-018). Same contract.
    groq.ts          # the ONLY module talking to Groq (Whisper large-v3, D-018).
    visual.ts        # frames -> visual delivery report + its deterministic rendering
    json.ts          # fence-strip + brace-salvage + Zod parse (§9.7 step 1)
    grounding.ts     # fuzzy quote matching — the hallucination check (§9.7 step 4)
    grade.ts         # the judge + postValidate() (§9.5, §9.7). Takes site AND/OR audio.
    qa.ts            # judge Q&A (§9.6)
    transcribe.ts    # audio -> timestamped transcript (Whisper-first, Gemini fallback)
  site/
    crawl.ts         # URL or local folder -> pages, source, screenshots @3 viewports
    metrics.ts       # §9.2 for websites — deterministic. NO LLM TOUCHES THESE NUMBERS.
  metrics/delivery.ts   # §9.2 for speech — deterministic. Same rule.
  transcript/format.ts  # mm:ss, [mm:ss] segment lines
tests/               # vitest. postvalidate.test.ts is the important one.
runs/                # gitignored. graded run output.
```

**Load-bearing invariants — do not quietly break these:**
- `site/metrics.ts`, `metrics/delivery.ts` and the timing check are **code, never the LLM**.
  Audio duration is read from the file (`music-metadata`). Whether a stylesheet is external,
  whether an image has alt text, whether the page overflows on a phone — all measured, never
  guessed. The judge is handed the answers and told not to re-derive them by eye.
- **The `assessable` flag is not decoration.** A criterion the submission *cannot evidence*
  (eye contact, with no recording) is excluded from the denominator, not scored zero. Breaking
  this means telling a student they failed a section they never submitted.
- `postValidate()` in `grade.ts` is a **pure function** so the planted-fake-quote test (§17 M8)
  can run with no API key. Keep it pure.
- One module per provider: `gemini.ts` (SDK), `openrouter.ts` (fetch), `groq.ts` (fetch).
  Swapping or removing a provider touches exactly one file; nothing else may call an AI API.
- **Thinking tokens count against `maxOutputTokens` on Gemini.** Too low a cap truncates the
  JSON mid-string and fails Zod. Don't lower `MAX_OUTPUT_TOKENS.grade` without doing the maths.

**Milestones:** M1 done (grader proven). **M2 = schema + RLS. M3 = auth.** Do not start M2 until
a human signs off on M1 against a *real* rubric and a *real* recording — the dev rubric proves
the machine, not the judgment.

