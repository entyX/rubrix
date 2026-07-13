# Rubrics — READ BEFORE ADDING ONE

## What is blocked, and why

`CLAUDE.md` states, without qualification:

> Do not invent product behavior. **Do not guess at FBLA rules. Do not make up rubric criteria.**

So the agent did **not** produce the three hand-structured rubrics that `plan.md` §23 asks for
(Public Speaking, Sales Presentation, Business Plan). It does not have the official rating
sheets, and inventing criteria that a student would then be scored against is the single
fastest way to make this product worse than useless. **This is a human task.**

The only file here is `_dev-generic-speech.rubric.json`, which is invented, is labelled as
invented, and exists purely so the pipeline can be run end to end. Any score it produces is
meaningless. It is not FBLA's, and it does not resemble FBLA's.

## What a human needs to do

For each launch event in `plan.md` §5:

1. Get the current-year official rating sheet from the org's competitive-events guide.
2. Hand-structure it into `RubricJSON` (`src/lib/ai/schemas.ts`), **restructured into our own
   JSON** — paraphrase descriptions, keep the point values.
3. Save as `rubrics/{org}-{event-slug}.rubric.json`.
4. Record `source_url` pointing at the official page.

## The legal line (plan.md §20)

- Official rating sheets are **the orgs' IP**.
- Restructure criteria into original JSON. **Never republish rubric PDFs or text wholesale.**
- The library links to official sources; it does not reproduce them.
- Every `[VERIFY]` value (time limits, page limits, team sizes) is checked against the
  current-year guide before seeding — orgs change these annually.

## Schema

```jsonc
{
  "title": "string",
  "total_points": 100,
  "source_url": "https://…",        // where the official sheet lives
  "criteria": [
    {
      "id": "snake_case_slug",       // ^[a-z0-9_]+$
      "name": "string",
      "description": "string",       // our words, not theirs
      "max_points": 20,
      "levels": [                    // optional, if the sheet uses performance bands
        { "label": "Exceeds", "points": 20, "descriptor": "…" }
      ]
    }
  ]
}
```

`sum(criteria.max_points)` should equal `total_points`. The parse/review UI (F3, milestone M6)
warns on a mismatch rather than blocking, because some official sheets genuinely don't add up.
