# later.md

plan.md §0: *"Scope is law. New ideas → later.md, not the sprint."*

Things noticed while building M1 that are **deliberately not being done now**.

## Deferred from M1

- **Audio segmentation for long files.** §9.1 says to segment audio over ~24MB and merge
  timestamp offsets. With `MAX_VIDEO_MIN=20` and mono 64kbps mp3, a max-length run is ~9.6MB —
  the branch is unreachable. `transcribe.ts` throws a clear error above the inline cap instead.
  Build it if the cap ever rises, or move to the Files API.
- **3-run median consistency check** (§9.7, "Phase 1.5+"). `seed` is already pinned, which is
  the cheaper half of the same goal. Revisit alongside the eval harness (M10), which is where
  run-to-run spread actually gets measured.
- **Slides / document grading.** The grader already handles document-sourced evidence
  (`evidence.source === 'document'` skips the transcript hallucination check), but nothing
  produces it yet. Needs the PDF path (F4).
- **Speaker diarization** for team events (§9.2 "speaker balance"). Currently reported as
  explicitly unmeasured rather than guessed.

## Ideas parked

- The generosity monitor (§9.7) needs somewhere to live — a rolling median per event implies a
  table and a cron. Probably lands with M8/M10.
- `runs/*.json` is already the exact shape the eval harness will want as a fixture. Consider
  making `scripts/eval.ts` (M10) consume the same file format so real runs become eval cases for
  free — plan.md §10 wants `grading_feedback` real-scores as a "free supplement" anyway.
- Cost is currently ~2.8¢/run against a 30¢ target — roughly 10× headroom. That budget could buy
  a stronger model for grading (2.5 Pro) if the eval bar (r ≥ 0.8) proves hard to clear on Flash.
  Make the model string a single constant so it can be A/B'd. (It already is: `models.ts`.)
