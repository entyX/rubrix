> ⚠️ **AMENDED — read `DECISIONS.md` alongside this file.**
> This plan is v5 and parts of it have been superseded by human decisions made during the build.
> Where the two disagree, **DECISIONS.md is newer and wins.** The live amendments:
> - **§6 / §9.1 / §9.8 — the AI provider is Google Gemini (`gemini-2.5-flash`), for BOTH grading
>   and transcription.** Not Anthropic Claude, not OpenAI Whisper. One key: `GEMINI_API_KEY`. (D-002)
> - **§9.7 — no time penalty is applied.** No penalty formula exists in this document and we do
>   not invent FBLA rules. Timing is computed and shown; zero points are deducted. (D-005)
> - **§23 — the three hand-structured rubrics were NOT written.** The agent has no official rating
>   sheets and `CLAUDE.md` forbids inventing rubric criteria. This is a human blocker. (D-004)

Rubrix — The Master Plan (v5, unified)
The AI-graded competition workspace for CTSOs. Launch org: FBLA.
One-liner: Upload a practice run of your event → get a judge-style, rubric-line-by-line score with cited evidence and the three fixes worth the most points → then plan your whole season around it.
Tagline: Know your score before the judges do.
Working name: Rubrix (trademark/domain check pending — alternates: Medalist · Gavel · TopSeed · JudgeReady · PrepCircuit)
Team: 2–5 students, part-time (~10–15 hrs/person/week). Real team: Ronit (AI pipeline + backend), + co-builders on frontend/design and data/eval.
Dates: Summer sprint starts July 14, 2026. Grader-first MVP by end of summer → fall pilot with North Creek HS FBLA → district/state season → optional public launch.
This file is the single source of truth. It is written to be executed by an AI coding agent or a new teammate straight through, milestone by milestone. It merges four prior specs (Rubrix master plan, CompDeck build spec, RubrixPrep v4, PrepDeck) into one: Rubrix's brand/design/pitch/business, RubrixPrep's engineering completeness (RLS, schemas, prompts, build order, eval harness, format taxonomy), CompDeck's executable summer discipline, and PrepDeck's strategic framing.
Contents: §0 how to use + agent manual · §1 problem/insight/positioning · §2 personas & core loop · §3 event format taxonomy · §4 feature scope · §5 launch events · §6 architecture & stack · §7 database + RLS · §8 API contract · §9 AI Judge pipeline (schemas + verbatim prompts) · §10 eval harness · §11 design system · §12 page-by-page frontend · §13 task templates · §14 seed data · §15 testing/errors/copy · §16 devops/CI/analytics · §17 roadmap · §18 business model · §19 go-to-market · §20 legal/privacy · §21 pitch deck · §22 metrics/milestones/risks · §23 this week.

§0 — HOW TO USE THIS DOC + AGENT OPERATING MANUAL
Execution order: §6→§7→§8→§9 define the machine; §11→§12 define the surface; §17 sequences the build as numbered milestones with acceptance criteria. Never start a milestone until the previous one's acceptance criteria pass locally. §14 (seed data) loads in week 1. §19–§21 are human-run; the agent only builds the assets named in them.
Operating rules (copy into CLAUDE.md at repo root):
Source of truth is this file. Build milestones in §17 order. Do not start M(n+1) until M(n)'s AC pass.
The grader is the product. When prioritization is ambiguous, grading quality and grading UX win. Everything else is retention.
Ship vertical slices. Every work session ends with something runnable end-to-end, even if ugly.
TypeScript strict; no any. Zod-validate every API body and every LLM output. Server components by default; client components only where interaction demands.
Prompts are code. Prompts live in lib/ai/prompts.ts with version headers — never hardcoded inline in application code. Any wording change bumps prompt_version, re-runs scripts/eval.ts, and records results in docs/prompt-changelog.md. Failing eval blocks the change.
Rubrics are structured, never republished. Rubric JSONs are paraphrased/restructured from official sheets; store source_url links only. Non-affiliation disclaimer (§20) in the footer and on every grade report.
Every table gets RLS before it gets UI. If you create a table, write its policies in the same migration. Never expose SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY client-side. AI + service-role logic lives in /api routes and lib/server modules only.
Privacy defaults are law (§20): minimum age 13 enforced at signup; original video never stored (audio only); raw assets auto-purge at 90 days; student data never used for training without an explicit consent flag; every query scoped to the workspace/chapter.
Design compliance (§11): every UI uses the tokens and rules in the design system. Screenshot every new screen and self-critique against §11 before marking a task done.
Cost discipline: target ≤ $0.30 average per graded run; log token usage + cost_cents per run to grading_runs. Console-warn if any single grade exceeds $0.75.
Scope is law. New ideas → later.md, not the sprint. [VERIFY]-tagged values (event time limits, page limits, API pricing) must be checked against the real world before seeding.
Stop and ask a human when: a product decision isn't in this spec, a dependency conflicts, an official event/rubric question arises, or an AC can't be met as written. Do not invent product behavior.
Keep DECISIONS.md (choices + why) and docs/prompt-changelog.md (every grading-prompt change with before/after eval results). Conventional commits (feat:, fix:, chore:, docs:); one milestone per PR; screenshots of new UI in the PR description.

§1 — PROBLEM, INSIGHT, POSITIONING
The market. 2M+ U.S. high-schoolers compete in CTSOs — FBLA (~200K), DECA (~225K), HOSA (~275K), TSA, SkillsUSA, BPA, FCCLA. Competitive events (speeches, sales presentations, role-plays, business plans) are judged against published official rubrics at district → state → national levels. Debate-team-meets-Shark-Tank, at national scale, in almost every high school.
The problem.
Students receive real scored feedback once or twice a year — at the competition itself, when it's too late to change anything.
One advisor : 100+ students across 60+ events. Detailed rubric feedback doesn't scale.
Prep is chaos: rubrics buried in 40-page PDFs, deadlines vary by event and state, team projects scattered across group chats and lost Google Docs.
Technical DQs: page limits, fonts, time limits, file formats — points lost before content is even judged.
The insight. Every event has a structured, published rubric. A rubric converts "give me feedback" — an open-ended task an LLM does poorly and generously — into a bounded, gradeable task an AI does reliably, with cited evidence per line. Nobody has built this loop end-to-end for CTSOs. Why now: frontier multimodal models × a market literally defined by rubrics.
Positioning. For CTSO members and advisors, Rubrix is the competition-prep workspace that scores your practice presentations against the official rubric structure using AI — so you walk on stage already knowing your score.
Alternative
Weakness we exploit
Notion / Trello / Google Docs
Generic; no rubrics, no events, no grading
Raw ChatGPT
No rubric structure, no video pipeline, no calibration/persistence/advisor layer; generosity-biased scores are worse than none
Advisor feedback
Doesn't scale (1 : 100+)
Mock judging days
Happen 1–2×/year at best

Moat: (1) hand-engineered rubric library with judge knowledge, (2) calibration dataset from advisor overrides + real-score entries, (3) chapter network effects (team events force multi-user adoption), (4) brand inside a tight community. "Why can't ChatGPT do this?" → no rubric structure, no pipeline, no calibration, no advisor layer, and it inflates scores.

§2 — PERSONAS & CORE LOOP
Personas.
Competitor (primary) — HS student, ages 13–18, 1–3 events; wants a plan and practice feedback.
Team Captain — runs a 2–5 person team event; wants tasks, files, milestones, team submissions.
Advisor (the buyer) — wants visibility into every team's readiness without watching 40 videos; pays via school PO/chapter funds. One advisor adoption = 20–100 members. Members churn yearly; advisors stay. Advisors are the distribution channel; members are the users.
Chapter/State Officers — evangelists; the growth channel.
Core loop. Create a workspace for an event → follow the auto-generated, back-scheduled task timeline → upload a practice run (video/PDF/link) + the event rubric → receive AI-judged, rubric-anchored feedback + judge-style Q&A → fix the highest-leverage weaknesses → re-run before competition.
North-star metric: weekly graded attempts per active team. If this is < 1, the product is dead regardless of signups.

§3 — EVENT FORMAT TAXONOMY (the key architectural decision)
Every event maps to one of four formats. Templates, UI affordances, checklist logic, and grading all key off FORMAT. This is what makes FBLA-deep-now + other-orgs-cheap-later possible: adding DECA/TSA/HOSA is a rubric + seed-data swap, not a rebuild.
Code
Description
Grading input
Q&A?
presentation_qa
Prepared presentation + judge Q&A
video (audio) + optional slides PDF
yes
prejudged_plus_presentation
Report/asset judged in advance + live presentation
PDF or link, AND/OR video
yes
roleplay_interview
Live scenario or interview with judge interaction
video (audio)
yes (scenario-style)
objective_test
Timed knowledge test
none in v1 (scheduler only)
no


§4 — FEATURE SCOPE (with acceptance criteria)
Phasing blends the summer-sprint reality (ship a trustworthy grader before school) with the longer arc (full workspace for the real season).
Phase 0 — Foundation (validate before building)
Auth (Google SSO + email, 13+ gate), org model (Chapter → Advisors → Members → Teams → Events), FBLA event catalog, 3 hand-structured rubrics, manual grading pipeline (script, no app). GO/NO-GO gate before any product code.
Phase 1 — MVP: "The Grader" (the differentiator)
F1 Auth — Google OAuth (schools live in Google Workspace) + email; 13+ gate; display name + chapter on first sign-in. AC: landing → signed-in dashboard in ≤ 3 clicks.
F2 Teams/Workspaces — create/join (8-char invite code + /join/[code] link), org+event+deadline, team_size_max enforced. AC: two accounts on one team both see the same submissions within 5s of upload.
F3 Rubrics — Path A: pick a pre-loaded library rubric. Path B: upload PDF → extract → Claude parses to structured JSON → mandatory human review table (editable) → confirm → locked canonical. AC: an uploaded FBLA rating sheet parses into line items whose max points sum to the stated total; user can correct any row before confirming; never grade on an unreviewed parse.
F4 Submissions — video (mp4/mov/webm, ≤ 20 min, audio extracted client-side via ffmpeg.wasm → only mp3 uploads) → Whisper transcript with timestamps; document (PDF/DOCX, ≤ 20MB) → text + page/word count; link. AC: a 7-min 1080p mp4 → timestamped transcript in under ~2–4 min on a school laptop.
F5 AI grading — per-criterion score with quoted evidence + timestamps, total, ranked point gaps (easiest fixes first), timing analysis, 5–10 mock judge Q&A from the actual weak spots, blunt 2–3 sentence overall note. Temperature 0–0.2, canonical rubric JSON, prompt_version logged. AC: passes the §10 eval protocol.
F6 Score history — per-team list of runs (date, total, delta), line chart of total over time, the medallion reveal. AC: after 3 runs the chart + deltas are correct.
Auto prep checklist from competition date; personal dashboard.
Phase 1 acceptance: upload→grade happy path e2e green; grade < 4 min; cost ≤ $0.30 avg logged; design passes §11 screenshot review.
Phase 2 — Team Workspace, Scheduler & Advisor layer
F7 Prep timeline planner — back-scheduled from competition date, 4 phases (research/draft/practice/polish) with per-format default tasks, assignable, editable, regenerate. AC: a 30-day-out team gets a populated, correctly date-mathed plan.
F8 Pre-submission checklist — per-event; auto-flags page count / duration / file type; manual toggles for the rest. AC: a 22-page PDF against a 20-page limit shows a red flag with no user action.
F9 Resource library — per org/event links + notes. AC: filtering by org+event shows only relevant resources.
F10 Advisor dashboard — read-only roster + readiness heatmap + latest score + last activity; recordings gated by per-team opt-in toggle (default private). AC: officer sees all chapter teams; member gets 403.
Email/push notifications & nudges.
Phase 3 — Depth & Scale
Live practice mode (in-browser recording, real-time pacing/filler HUD, full grade after) · DECA catalog + role-play simulator (AI plays judge/customer live) · peer review with the same rubric UI · draft diffing for written events · real-score → AI-score accuracy study · state-specific deadlines/variants · retrieval-augmented grading from past examples · PWA/mobile.
Explicitly NOT building (v1)
Objective-test engine · generic chat assistant · native mobile apps · payments (until retention proven) · custom-trained ML model · leaderboards · peer matching · official registration/scoring (stay complementary to the orgs, never competitive). New ideas → later.md.

§5 — LAUNCH EVENTS (FBLA-first, mapped to the four formats)
Every rubric is hand-structured by a human before its event goes live. Rubric quality is the product. All limits [VERIFY] against the current-year official competitive-events guide — orgs publish updated guidelines late summer and values change yearly.
Event
Format
Asset
Why
Public Speaking
presentation_qa
video ~4–5 min
Simplest pipeline; audio-dominant
Impromptu Speaking
presentation_qa
video
Adds time-pressure metrics
Sales Presentation
presentation_qa
video (+ slides)
Multimodal; frames matter
Intro to Business Presentation
presentation_qa
video + slides
Slide detection, team diarization
Business Plan
prejudged_plus_presentation
PDF report + pitch video
Document + presentation grading
Electronic Career Portfolio
prejudged_plus_presentation
site/PDF + video
Mixed asset
Broadcast Journalism
prejudged_plus_presentation
produced video
Production-quality criteria
Job Interview
roleplay_interview
mock-interview video
Q&A criteria
Future Business Leader
roleplay_interview
resume + interview
Document + interview
Emerging Business Issues
presentation_qa
team argument video
Team + argumentation

Objective-test events (Marketing, Business Management, etc.) get the scheduler + resources only in v1 (no grader) — they still onboard the member and pull them into the loop.

§6 — ARCHITECTURE & STACK
Stack (fixed — chosen for cheap, boring, fast-to-build; do not relitigate):
Layer
Choice
Why
Framework
Next.js 15 (App Router, TS strict) on Vercel
Frontend + API routes in one deploy
Styling
Tailwind (tokens via CSS custom properties, §11) + shadcn/ui + lucide-react


DB / Auth / Storage / Realtime
Supabase (Postgres 15, RLS on from day 1)
Free tier, built-in auth + storage; Google SSO for school accounts
Audio extraction
ffmpeg.wasm in the browser → mono 64kbps mp3 before upload
A 15-min talk ≈ 7MB, under Whisper's ~25MB cap; large video never touches our servers — sidesteps serverless ffmpeg limits entirely
Transcription
OpenAI Whisper API (whisper-1, verbose_json for word timestamps) [VERIFY model/pricing]


Grading LLM
Anthropic Claude Sonnet-class, server-side only [VERIFY model string/pricing]


PDF/DOCX text
pdf-parse / mammoth (npm); if < 100 chars/page → flag as scanned, reject (no OCR in MVP)


Client data / board / charts
TanStack Query v5 · dnd-kit · recharts


3D
React Three Fiber (in-app medallion) + lightweight three.js (marketing)
Score medallion only
Validation
Zod at every boundary (API bodies + every LLM JSON output)


Analytics / Errors
PostHog (free tier) / Sentry-style console + ?debug admin page


Hosting / CI
Vercel + GitHub Actions



Serverless fallback ladder (decide by Wed of week 1 — do not discover in week 4): (1) long-running route with extended maxDuration for /api/gradings (300s) and /api/transcribe (60s); (2) if Whisper input > cap, segment audio and offset/merge timestamps; (3) if still painful, a tiny worker on Railway/Fly free tier polling a jobs table. Because audio extraction is client-side, the server only ever handles an mp3 + a Whisper call + LLM calls, so (1) is expected to suffice.
Environment variables (.env.example):
NEXT_PUBLIC_SUPABASE_URL=            NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server only, never NEXT_PUBLIC
ANTHROPIC_API_KEY=                  # server only
OPENAI_API_KEY=                     # server only (Whisper)
NEXT_PUBLIC_APP_URL=                NEXT_PUBLIC_POSTHOG_KEY=
GRADING_MONTHLY_LIMIT=8             # free tier, per user per calendar month
MAX_VIDEO_MIN=20  MAX_DOC_MB=20
PROMPT_VERSION_GRADING=g-1.0.0      PROMPT_VERSION_RUBRIC=r-1.0.0
Repo structure (monorepo-lite, single Next app):
Rubrix/
  CLAUDE.md                         # §0 agent manual
  docs/ {plan.md, DECISIONS.md, prompt-changelog.md, eval-results/}
  src/
    app/
      (public)/                     # landing, login, signup, invite/[token], privacy, terms
      (app)/                        # authed shell: Sidebar + Topbar
        dashboard/page.tsx
        workspaces/new/page.tsx
        w/[workspaceId]/ { page, tasks, judge, judge/[gradingId], judge/[gradingId]/practice, checklist, resources, settings }
        resources/ , resources/[org]/[eventSlug]/
        officer/page.tsx
        settings/page.tsx
      api/                          # §8 full contract
    components/ ui/ layout/ workspace/ tasks/ judge/ report/ practice/ resources/ shared/
    lib/
      supabase/ {client, server, admin, middleware}
      ai/ {prompts.ts, schemas.ts, parseRubric.ts, grade.ts, qa.ts, practice.ts, anthropic.ts, whisper.ts}
      audio/extractAudio.ts         # ffmpeg.wasm
      parsing/ {pdf.ts, docx.ts}
      templates/taskTemplates.ts
      usage.ts  limits.ts  analytics.ts  copy.ts
    types/
  supabase/migrations/
  scripts/ {seed.ts, eval.ts, eval-cases/}
  e2e/                              # Playwright
  later.md

§7 — DATABASE SCHEMA + ROW LEVEL SECURITY
Single initial migration. RLS on every table from day 1. Enums keep states honest.
sql
create extension if not exists pgcrypto;

create type user_role       as enum ('member','officer','advisor');
create type event_format    as enum ('presentation_qa','prejudged_plus_presentation','roleplay_interview','objective_test');
create type submission_kind as enum ('video','pdf','link');
create type run_status      as enum ('queued','processing','done','failed');
create type grading_status  as enum ('queued','grading','complete','failed');
create type phase           as enum ('research','draft','practice','polish');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null unique,
  display_name text not null,
  grad_year int,
  chapter_id uuid,                        -- fk added after chapters
  role user_role not null default 'member',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table chapters (
  id uuid primary key default gen_random_uuid(),
  name text not null, school text not null, state text, ctso text,
  created_at timestamptz not null default now()
);
alter table profiles add constraint profiles_chapter_fk foreign key (chapter_id) references chapters(id);

create table orgs   (id text primary key, name text not null);           -- 'fbla','deca','tsa','hosa','fpspi'
create table events (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs,
  name text not null, slug text not null,
  format event_format not null,
  time_limit_s int, qa_time_s int, page_limit int,
  team_size_min int not null default 1, team_size_max int not null default 3,
  qa_format text,                          -- prose used verbatim in grading prompt
  requirements jsonb not null default '[]', -- [{id,label,auto:'page_count'|'duration'|'file_type'|null,param}]
  official_guidelines_url text,
  unique (org_id, slug)
);

create table workspaces (                  -- a.k.a. "teams"
  id uuid primary key default gen_random_uuid(),
  name text not null,
  chapter_id uuid not null references chapters,
  event_id uuid not null references events,
  competition_date date not null,
  prejudged_deadline date,                 -- only for prejudged_plus_presentation
  invite_code text not null unique,        -- 8 chars A-Z0-9
  share_recordings_with_officers boolean not null default false,
  created_by uuid not null references profiles,
  created_at timestamptz not null default now()
);
create table workspace_members (
  workspace_id uuid references workspaces on delete cascade,
  user_id uuid references profiles on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  role_label text,                         -- free text: 'research','design','presenter'
  primary key (workspace_id, user_id)
);
create table workspace_invites (
  token uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  invited_email text, created_by uuid not null references profiles,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_by uuid references profiles, created_at timestamptz not null default now()
);

create table rubrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces on delete cascade,  -- null for library rubrics
  event_id uuid references events,
  title text not null,
  source text not null check (source in ('official','uploaded')),
  source_file_path text, source_url text, raw_text text,
  parsed jsonb,                            -- RubricJSON (§9 F1)
  confirmed boolean not null default false,
  prompt_version text,
  created_by uuid references profiles, created_at timestamptz not null default now()
);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  uploader_id uuid not null references profiles,
  kind submission_kind not null,
  storage_path text,                       -- audio mp3 for video, pdf path for doc
  slides_path text, original_filename text, link_url text,
  duration_s int, page_count int, word_count int,
  transcript jsonb,                        -- {full_text, segments:[{start,end,text}]}
  status run_status not null default 'queued', error text,
  purge_at timestamptz default now() + interval '90 days',
  created_at timestamptz not null default now()
);

create table gradings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  submission_id uuid not null references submissions on delete cascade,
  rubric_id uuid not null references rubrics,
  status grading_status not null default 'queued',
  result jsonb,                            -- GradingResultJSON (§9 F1)
  qa jsonb,                                -- QAJSON (§9 F1)
  total_awarded numeric, total_max numeric, medal_tier text,
  model_version text, prompt_version text,
  input_tokens int, output_tokens int, cost_cents int,
  consistency_variance numeric,           -- from 3-run median flagging
  fail_reason text,
  created_by uuid not null references profiles, created_at timestamptz not null default now()
);
create index gradings_ws_idx on gradings (workspace_id, created_at desc);

create table grading_feedback (           -- becomes the calibration/eval dataset for free
  grading_id uuid primary key references gradings on delete cascade,
  accuracy_rating int check (accuracy_rating between 1 and 5),
  human_override_json jsonb,              -- advisor per-item overrides
  real_score numeric, real_score_max numeric, notes text,
  updated_at timestamptz not null default now()
);

create table practice_turns (            -- Phase 3 live Q&A drill
  id uuid primary key default gen_random_uuid(),
  grading_id uuid not null references gradings on delete cascade,
  question_index int not null, user_answer text not null,
  score int check (score between 1 and 5), feedback text, follow_up text,
  created_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  phase phase, title text not null, description text,
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  assignee uuid references profiles, due_date date,
  is_milestone boolean not null default false, sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index tasks_ws_idx on tasks (workspace_id, status, sort_order);

create table resources (
  id uuid primary key default gen_random_uuid(),
  org text not null, event_id uuid references events,   -- null = org-wide
  title text not null, url text not null, note text,
  kind text not null default 'other'
    check (kind in ('official_rubric','guidelines','prep_guide','example','other')),
  approved boolean not null default false,
  submitted_by uuid references profiles, created_at timestamptz not null default now()
);

create table usage_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles,
  action text not null,                    -- 'grading','transcription','qa','practice_turn'
  cost_cents int not null default 0, created_at timestamptz not null default now()
);
create index usage_user_month_idx on usage_ledger (user_id, created_at);
RLS (complete pattern — write the rest from this):
sql
create or replace function is_ws_member(w uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from workspace_members where workspace_id = w and user_id = auth.uid());
$$;
create or replace function is_ws_owner(w uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from workspace_members
                 where workspace_id = w and user_id = auth.uid() and role = 'owner');
$$;
create or replace function is_chapter_officer(c uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from profiles
                 where id = auth.uid() and chapter_id = c and role in ('officer','advisor'));
$$;

alter table profiles enable row level security;
create policy "own profile read"   on profiles for select using (auth.uid() = id);
create policy "own profile write"  on profiles for update using (auth.uid() = id);
create policy "own profile insert" on profiles for insert with check (auth.uid() = id);
create policy "officer chapter read" on profiles for select using (is_chapter_officer(chapter_id));

alter table orgs   enable row level security;  create policy "orgs public read"   on orgs   for select using (true);
alter table events enable row level security;  create policy "events public read" on events for select using (true);

alter table workspaces enable row level security;
create policy "ws member read"  on workspaces for select using (is_ws_member(id) or is_chapter_officer(chapter_id));
create policy "ws create"       on workspaces for insert with check (auth.uid() = created_by);
create policy "ws owner update" on workspaces for update using (is_ws_owner(id));
create policy "ws owner delete" on workspaces for delete using (is_ws_owner(id));

-- tasks, rubrics, submissions, practice_turns: membership pattern
alter table tasks       enable row level security;
create policy "tasks rw" on tasks for all using (is_ws_member(workspace_id)) with check (is_ws_member(workspace_id));
alter table rubrics     enable row level security;
create policy "rubrics rw" on rubrics for all using (is_ws_member(workspace_id) or workspace_id is null)
  with check (is_ws_member(workspace_id));
alter table submissions enable row level security;
create policy "subs rw" on submissions for all using (is_ws_member(workspace_id)) with check (is_ws_member(workspace_id));

-- gradings: members read; officers read chapter; inserts/updates via service-role routes only
alter table gradings enable row level security;
create policy "gradings read" on gradings for select
  using (is_ws_member(workspace_id) or exists (select 1 from workspaces w
         where w.id = workspace_id and is_chapter_officer(w.chapter_id)));

alter table resources enable row level security;
create policy "resources public read" on resources for select using (approved = true);
create policy "resources suggest"     on resources for insert with check (auth.uid() = submitted_by);
create policy "resources admin all"   on resources for all
  using (exists (select 1 from profiles where id = auth.uid() and is_admin));

alter table usage_ledger enable row level security;
create policy "usage self read" on usage_ledger for select using (auth.uid() = user_id);
-- usage_ledger, gradings, invites acceptance: writes via service role only
Storage. Buckets submissions, rubrics (both private). Path {workspaceId}/{uuid}.{ext}; policies mirror is_ws_member on the first path segment. Signed URLs (60 min) for playback/download — and advisor playback URLs are only issued by server code when share_recordings_with_officers = true (enforced in the API layer, since signed URLs come from server routes, not RLS).
Usage limits. Free tier: 8 gradings/user/calendar month (pilot-generous). Grading route counts usage_ledger rows where action='grading' this month → over limit = HTTP 429. Also a per-team daily cap (5) and a per-user global abuse backstop (15/day).

§8 — API CONTRACT
All routes under /api, authed via Supabase session; every route verifies session then workspace membership where relevant. Zod-validate every body → invalid = 400 {error:{code,message,issues}}. Errors: 401 no session · 403 not member/officer · 404 not found · 429 rate limit · 500 logged with id. Service-role client (SR) only where marked.
Route
Method
Body / params
Returns
Notes
/api/invites/accept
POST
{token}
{workspaceId}
SR: validate token unexpired/unused, insert membership, mark accepted
/api/workspaces
POST
{name,event_id,competition_date,prejudged_deadline?}
{workspace}
Generates invite_code; creator = owner; auto-generates §13 template tasks
/api/workspaces/[id]
GET / PATCH
PATCH {name?,competition_date?,share_recordings_with_officers?}
{workspace,members,latest_grading}
Deadline change re-offers plan regeneration (?regenerate=true)
/api/workspaces/[id]/join
POST
{code}
{workspace}
403 wrong code · 409 team full (team_size_max)
/api/rubrics
POST
multipart file, workspace_id|event_id
{rubric}
Stores file, extracts raw_text server-side
/api/rubrics/[id]/parse
POST
–
{parsed, warnings[]}
SR → Claude (§9 F2). Does NOT auto-save; idempotent; re-parse overwrites unconfirmed only
/api/rubrics/[id]
PATCH
{parsed}
{rubric}
User edits from review table; rejects if confirmed
/api/rubrics/[id]/confirm
POST
–
{rubric}
Validates every item has criterion + max_points>0; locks rubric
/api/submissions
POST
{workspace_id,kind,filename,size}
{submission,signed_upload_url}
Server-side size/type check BEFORE issuing URL
/api/submissions/[id]/process
POST
–
{submission}
SR. Client calls after upload. Video: Whisper on the mp3. Doc: pdf-parse/mammoth. Idempotent (skip if ready)
/api/transcribe
POST
{submissionId}
{status}
SR. Whisper verbose_json, store transcript, ready/failed. maxDuration=60
/api/gradings
POST
{workspace_id,submission_id,rubric_id}
{gradingId} then processes inline
SR. 429 if over limit; 409 if submission not ready or rubric not confirmed. Runs §9 pipeline, updates status live. maxDuration=300
/api/gradings/[id]
GET
–
grading row
Poll target (client polls every 3s while processing)
/api/gradings/[id]/practice
POST
{questionIndex,answer,priorFollowUp?}
{score,feedback,followUp?}
Phase 3. Logs practice_turns + usage
/api/tasks , /api/tasks/[id]
POST / PATCH / DELETE
task fields
{task}


/api/resources
GET / POST
GET ?org&event_id · POST {org,event_id?,title,url,note}
list / {resource}
POST requires officer/advisor
/api/officer/teams
GET
–
[{team,event,member_count,latest_total,last_activity}]
officer/advisor only; 403 for members
/api/link-preview
POST
{url}
{ok,title?}
Validates link submissions; 5s timeout; http(s) only; blocks private IP ranges
/api/account
DELETE
–
{ok}
SR cascade delete auth user + storage objects

Rate limit: 10 req/min per user on AI routes (in-memory ok for v1). Never log full transcripts at info level (privacy) — debug flag only, off in prod.

§9 — AI JUDGE PIPELINE (the core)
Sequencing law: pipeline → prompt engineering → evals → (only if evals demand) fine-tuning. Do NOT train a model first. A frontier LLM + a well-structured rubric gets 80% of the quality; defensibility comes from the rubric library, calibration data, and pipeline. A trained grader would need hundreds of scored artifacts per event — that dataset doesn't exist yet. Every logged grading_run this fall becomes labeled data if a fine-tuned v2 ever makes sense.
9.1 Video & document pipeline
video → ffmpeg.wasm (browser): -vn -ac 1 -ar 16000 -b:a 64k → mp3
      → signed upload (mp3 only; original video never leaves the device)
      → /api/transcribe: Whisper whisper-1, verbose_json, language 'en', word timestamps
      → if mp3 > ~24MB: segment (segment_time 600), transcribe sequentially,
        offset timestamps by cumulative duration, merge
      → store transcript {full_text, segments:[{start,end,text}]}, duration_s from metadata
document → pdf-parse / mammoth → if avg chars/page < 100: fail ("looks scanned, export a
        text-based PDF") → store page_count + word_count
Each stage idempotent, retryable, observable; failure writes status='failed' + human-readable error (I3 matrix).
9.2 Deterministic metrics (code, not the LLM — trustworthy, injected into grading)
WPM · fillers/min (um,uh,like,you know, sentence-initial so) · longest pause · duration vs limit · speaker balance (team events) · reading-vs-speaking heuristic. Time limits are checked in code, never by the LLM.
9.3 Zod schemas (lib/ai/schemas.ts)
ts
export const RubricJSON = z.object({
  title: z.string(), total_points: z.number().positive(),
  criteria: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_]+$/), name: z.string(), description: z.string(),
    max_points: z.number().positive(),
    levels: z.array(z.object({ label: z.string(), points: z.number(), descriptor: z.string() })).optional()
  })).min(1).max(40)
});

export const GradingResultJSON = z.object({
  total_score: z.number(), total_possible: z.number(),
  tier: z.enum(['needs_work','competitive_regional','competitive_state','competitive_national']),
  summary: z.string(), top_priorities: z.array(z.string()).length(3),
  criteria: z.array(z.object({
    criterion_id: z.string(), score: z.number(), max_points: z.number(),
    confidence: z.enum(['high','medium','low']),
    not_assessable_reason: z.string().optional(),
    justification: z.string(),
    evidence: z.array(z.object({ quote: z.string(), timestamp_start: z.number().optional() })),
    improvements: z.array(z.string()).min(2).max(4),
    difficulty: z.enum(['easy','medium','hard'])           // fix effort, for point-gap ranking
  })),
  point_gaps_ranked: z.array(z.object({
    criterion_id: z.string(), points_available: z.number(), difficulty: z.enum(['easy','medium','hard'])
  })),
  timing: z.object({ limit_s: z.number(), actual_s: z.number(), over: z.boolean(), note: z.string() }).optional()
});

export const QAJSON = z.object({
  questions: z.array(z.object({
    question: z.string(), targets: z.string(),
    difficulty: z.enum(['warmup','standard','hard']),
    answer_points: z.array(z.string()).min(2).max(4)
  })).min(8).max(12)
});

export const PracticeTurnJSON = z.object({
  score: z.number().int().min(1).max(5), feedback: z.string(), follow_up: z.string().optional()
});
9.4 Rubric parse prompt (prompts.ts, version r-1.0.0, temp 0.2)
System (verbatim):
You convert competition rubric text into structured JSON for automated judging.
Output ONLY valid JSON, no markdown fences, no commentary.

Rules:
- Extract EVERY scored line item exactly as written. A line item has a criterion
  name, an optional description, and a maximum point value. Never invent, merge,
  or rename criteria. Preserve the rubric's own wording in descriptions.
- If the rubric groups items under sections, include the section name.
- If the rubric uses performance levels (e.g. "Does not meet / Meets / Exceeds"
  with point values, or tiers like "0-5-10"), capture them in "levels"; max_points
  is the highest value.
- Non-scored guidance (instructions, tie-breakers) goes in "notes", not criteria.
  Include point PENALTIES as criteria only if they carry explicit point values.
- id: short snake_case slug derived from the name.
- If the document does not appear to be a scoring rubric, return
  {"title":"NOT_A_RUBRIC","total_points":0,"criteria":[]}.
Output only JSON matching the RubricJSON schema.
User message = raw rubric text (or the PDF as a native document content block). Server validates with Zod; warns in the review UI when sum(max_points) != total_points, criteria count > 25, or NOT_A_RUBRIC (don't block — some rubrics genuinely mismatch).
9.5 Grading system prompt (prompts.ts, version g-1.0.0, temp 0.2)
System (verbatim; double-brace placeholders filled server-side):
You are a veteran {{ORG}} competition judge for the event "{{EVENT_NAME}}" at the
state and national level. You have judged this event for years and you grade the
way real judges grade: fair, specific, rigorous, and stingy with top marks.
Inflated practice scores hurt students at the real competition.

INPUTS: the official rubric (JSON) and a competitor's submission — a timestamped
transcript of a spoken presentation, and/or an attached document (report/slides),
plus computed delivery metrics you can trust.

SCORING RULES
1. Score every rubric criterion independently, in rubric order. Skip nothing.
2. Score ONLY what is demonstrated. Never credit what a student probably meant.
3. Evidence-first: for each criterion, quote the exact words from the submission
   (verbatim, with the transcript segment start time) that justify the score. No
   evidence -> low score, and state precisely what was missing and where it should
   have appeared. Never invent quotes.
4. Calibration: max points means flawless national-final quality. A typical first
   practice run lands at 55-85% of total. Award >90% on a criterion only when it
   would impress a veteran judge; award full marks on the overall total essentially
   never. When torn between two levels, choose the lower unless evidence clearly
   supports the higher. {{SCORE_ANCHORS}}
5. Modality honesty: if a criterion targets visuals/design/appearance and you only
   have an audio transcript, set confidence to "low", explain in
   not_assessable_reason, and score only what is verbally evidenced. If slides are
   attached, judge visual criteria from them at confidence "high". Do not penalize
   spoken disfluencies ("um", restarts) unless a delivery criterion explicitly
   covers fluency.
6. Timing: the event limit is {{TIME_LIMIT}} and this run was {{ACTUAL_DURATION}}.
   Factor pacing into relevant criteria and report it in "timing". (The numeric time
   penalty itself is applied in code, not by you.)
7. Improvements: 2-4 per criterion, each ONE concrete action a team could do this
   week ("Replace your opening statistic with a one-sentence story about a real
   customer"; "State the exact Gini coefficient and what it implies for host-nation
   equity"), never generic advice ("be more engaging"). Rate each criterion's fix
   difficulty: easy (<1hr), medium (an evening), hard (multi-day).
8. point_gaps_ranked: the criteria with the most recoverable points, ranked by
   (points available x ease of fix).
9. summary: 3-5 sentences, blunt, specific, coach's voice, second person. Open with
   the strongest real moment; end with the single highest-leverage fix. No praise
   sandwiches, no "AI magic".
10. tier by overall percentage: needs_work <55, competitive_regional 55-70,
    competitive_state 70-85, competitive_national >85.
Output ONLY valid JSON matching the GradingResultJSON schema. No fences, no commentary.
User content assembly:
<rubric>{parsed_json}</rubric>
<submission format="{video|document}" duration_s="{n}" time_limit_s="{n}" team_size="{n}">
TRANSCRIPT (one line per segment): [mm:ss] text ...
</submission>
DELIVERY METRICS (computed, trustworthy): {metrics_json}
[+ slides/report PDF as a document content block when present]
A 15-min talk ≈ 3k tokens; if a transcript exceeds ~60k tokens, fail with a friendly "too long" message rather than degrade quality.
9.6 Q&A prompt (version g-1.0.0, temp 0.7)
System (verbatim):
You are the same judge. You just scored this presentation (grading JSON attached).
Generate the 8-12 questions a skeptical judge would actually ask in the Q&A period,
in this event's real Q&A style: {{QA_FORMAT_DESCRIPTION}}.
- Target THIS submission's weak, vague, or unsupported spots and any criterion
  scored below 70%. Prioritize unsupported claims, methodology gaps, feasibility
  and budget challenges, and the "why" behind key decisions.
- Phrase questions the way real judges speak: short, direct, occasionally two-part.
- Mix types: 2-3 warmup, mostly standard, 2-3 hard. Every question must be
  answerable by a stronger version of THIS same project; no gotchas about content
  the event does not require.
- targets: what triggered the question. answer_points: the 2-4 things a winning
  answer would hit, written so a student can self-check.
Output ONLY valid JSON matching the QAJSON schema.
9.7 Post-grade validation (grade.ts, before saving — all hard-fail → retry once, then failed)
Zod parse (strip accidental ``` fences first).
Criterion coverage: every rubric criterion id present exactly once; missing → retry appending "Your previous output failed validation: {issues}. Output corrected JSON only."
Arithmetic: recompute total_score from criteria in code; if the model's total differs, trust the sum and overwrite. Apply the code-computed time penalty.
Hallucination check (non-negotiable): every transcript-sourced evidence.quote must be a substring of transcript.full_text (whitespace/case-normalized, ≥ 85% fuzzy match). Any failure → strip the quote and drop that criterion's confidence one step; if it's the only evidence, re-run that item once, then flag. Document quotes are tagged "from document" and skip the transcript check. Log the hallucinated-quote count to eval metrics.
Clamp every score to [0, max_points].
Consistency (Phase 1.5+): run grading 3× (temperature variance), take the per-item median; variance > 1 level flags the item "soft" and stores consistency_variance as a rubric-health metric.
Low-confidence floor: confidence: low renders as "Judge's note: hard to assess from this recording", never as an authoritative number.
Generosity monitor: rolling median first-attempt score per event; if it drifts above the anchor band, tighten prompts.
9.8 API client behavior (anthropic.ts)
Timeout 120s. Retries: 2, exponential backoff, on 429/5xx/timeout only. max_tokens sized to schema (parse 4k, grade 8k, qa 3k, practice 1k). Log per call: model, prompt_version, input/output tokens, cost_cents [VERIFY per-token pricing → hardcode as constants with a source-URL comment], latency, run id.
9.9 Practice-turn prompt (Phase 3, version g-1.0.0, temp 0.2)
System (verbatim):
You are the judge running a live Q&A drill. Given the question, the ideal
answer_points, and the student's answer (and optionally your prior follow-up and
their reply), score the answer 1-5: 5 = hits all answer_points with specifics;
3 = partially there or vague; 1 = wrong, empty, or dodges. feedback: 2-3 sentences
naming exactly what was missing. Ask ONE follow_up only if a specific hole remains
and no follow-up was already asked (max 2 follow-ups total). Output ONLY JSON
matching the PracticeTurnJSON schema.

§10 — EVAL HARNESS & PROTOCOL (ship gate — no public launch without it)
The eval set is the regression suite. It lives forever and re-runs on any change to a prompt, model string, or post-validation.
Golden set. Start with 6–8 real artifacts in week 2 (own + teammates' practice recordings, the SlimeShield DECA written entry, old FBLA presentation recordings, one deliberately weak 2–3 min ramble recorded on purpose, one strong run). Grow toward 60 real performances during the fall pilot, each scored independently by 2 human judges/advisors (pay $30–50/video; ~$2–3K total — the highest-ROI spend in the plan; use grading_feedback real-score entries as a free supplement).
Case format (scripts/eval-cases/{case}/): rubric.json, transcript.json (or doc.pdf), expected.json {score_min_pct, score_max_pct, tier, must_mention:[], notes}. Runner executes grade (+QA) 3× and prints a table: case | pct | in-band? | tier match? | hallucinated-quote count | must_mention hits | run-to-run spread | cost, then writes docs/eval-results/{date}-{prompt_version}.md.
Pass criteria to ship a prompt change:
Total-score Pearson r ≥ 0.8 vs human consensus (human-vs-human agreement is the ceiling, measured too).
|AI − human| ≤ 8 pts on total; item-level MAE tracked per event.
Run-to-run spread across the 3 runs ≤ 3 pts.
Zero hallucinated quotes after §9.7 stripping.
≥ 80% of "fix" fields judged actionable by both humans (blind yes/no vote).
No event regresses > 2 pts MAE vs the previous prompt version.
Seed cases (minimum 6): a strong nationals-quality run (expect competitive_national, 85–100% band, must_mention the specific methods/terms by name); an early practice run (expect state band); the deliberately weak run (expect needs_work); a teammate's different-event video; one DECA written-event PDF; one adversarial case (off-topic audio against a rubric — expect very low scores, zero hallucinated quotes).
Fine-tuning gate (Month 6+, only if): r < 0.8 on ≥ 3 events after prompt iteration, OR cost requires a tuned smaller model. Try retrieval first — inject the 3 nearest human-scored examples (same event, similar band) into grading context before considering fine-tuning.

§11 — DESIGN SYSTEM: "CHAMPIONSHIP METAL, CUPERTINO FINISH"
The brief: light/dark metallic and glossy · NOT minimalist · NOT sci-fi futuristic · NOT generic-AI aesthetic · must read like a $250K build · with the material honesty and obsessive finish of an Apple product page (macOS aluminum, Apple Watch "Hermès" lighting, AirPods Pro scroll moments), applied to the world of trophies and medals.
Concept: the visual world of the award itself — machined aluminum, gunmetal, polished trophy gold — presented with Apple's discipline: enormous confident type, generous negative space around rich material surfaces, frosted-glass layers, hairline borders, physics-real motion, zero visual noise that isn't a material. "Not minimalist" means rich materials and dimensional depth, not clutter: every surface feels like something, in very few colors.
Two personalities coexist deliberately: the shadcn/indigo product UI (§11.9) for fast, legible day-to-day workspace/board/report screens, and the Championship Metal treatment for the moments that sell — the marketing hero, the score reveal, the medallion. Use metal where it earns attention; use clean indigo where users work.
11.1 Color tokens
css
/* dark (default) — machined graphite, like a Space Black MacBook */
--bg:#121417; --bg-elev:#17191E; --panel:#1E2128; --panel-raised:#262A32;
--hairline:rgba(255,255,255,.09); --edge-l:rgba(255,255,255,.08); --edge-d:rgba(0,0,0,.45);
--text:#F2F4F7; --dim:#98A0AD; --ribbon:#8E2C35;
/* light — silver aluminum, like a studio-lit MacBook Air page */
--bg:#F5F5F7; --bg-elev:#FFFFFF; --panel:#FFFFFF; --panel-raised:#FFFFFF;
--hairline:rgba(20,24,32,.10); --text:#1D1D1F; --dim:#6E6E73;
/* metals — always gradients + moving specular, never flat */
--gold:linear-gradient(160deg,#F0D48A 0%,#D4A94E 42%,#9A7429 78%,#E8C86E 100%); --gold-text:#D4A94E;
--silver:linear-gradient(160deg,#F4F6F9 0%,#C6CCD6 45%,#8B94A3 80%,#E4E8EE 100%);
--steel:linear-gradient(160deg,#4A515E 0%,#2E333D 55%,#565E6C 100%);
/* score semantics (used in bars/chips, always paired with text, never color-only) */
--score-hi:emerald-500 (>=85%); --score-mid:amber-500 (60-84%); --score-lo:red-500 (<60%);
11.2 Typography (the Apple half)
Display: system SF stack — -apple-system,"SF Pro Display","Helvetica Neue",Inter,sans-serif, weights 600–700, tracking −0.015em to −0.03em at large sizes. Big, calm, confident sentence-case ("Know your score before the judges do."), not shouty all-caps.
Reserve an all-caps ARCHIVO-expanded treatment ONLY for eyebrows/labels and medal engraving, where the trophy world earns it.
Body: same stack, 400/500, 17px base, line-height 1.5, --dim for secondary.
Data/mono: SF Mono stack for every score, timer, point value — numbers are instruments.
Scale: 12 / 15 / 17 / 21 / 28 / 40 / 56 / 80 with clamp() heroes.
11.3 Materials & surfaces
Plates (cards/panels): metal with machined bevel — inset 0 1px 0 var(--edge-l), inset 0 -1px 0 var(--edge-d) + one soft ambient shadow. Radius 16–20px (continuous squircle). 2–3% SVG grain so nothing reads flat.
Glass: frosted backdrop-filter: blur(20px) saturate(1.6) for nav, sheets, overlays only — glass floats above metal, never metal above glass.
Hairlines: 1px --hairline separators wherever Apple would use them (list rows, nav bottom, table rules). Engraved 2-line divider reserved for trophy-flavored marketing surfaces.
Specular: primary buttons + the medallion get a moving highlight sweep on hover (600ms). Interactive plates get a subtle static sheen from top-left.
Focus: 2px --gold-text ring, offset 3px — accessibility as a brand detail.
11.4 Signature element — the Score Medallion
Every grade reveals a 3D metal medallion (React Three Fiber in-app; lightweight three.js on marketing), env-mapped for real studio-lighting reflections.
Material tiers by score: steel < 60 · silver 60–79 · gold 80+. Improving literally upgrades your metal.
Reveal (~2.4s, Apple-keynote pacing): medallion drops with weight (spring, slight settle) → 540° decelerating spin → engraved score counts up odometer-style → rubric categories fan out like plaque lines. One orchestrated moment; everything else on the page stays still.
One-tap export as vertical video/image (the TikTok unit — the whole growth loop).
Fallback: CSS radial-gradient medallion for reduced-motion / no-WebGL.
11.5 Motion (physics-real, never bouncy-cartoonish)
Easings cubic-bezier(0.16,1,0.3,1) for entrances; Framer Motion springs (stiffness 260, damping 30) for interactive weight. Durations: micro 200ms · component 350–500ms · orchestrated 600–900ms. One Apple-style scroll-driven hero sequence (GSAP ScrollTrigger camera dolly around the medallion) — one great scroll moment, not ten. Numbers always roll (odometer). prefers-reduced-motion: transforms off, opacity only, 3D → static render.
11.6 Component rules (metal surfaces)
Primary button: gold-gradient plate, dark engraved label, inner bevel, specular sweep, radius 12px; label says exactly what happens ("Get graded", "Plan my season"). Secondary: steel plate, chrome text. Tertiary: hairline-bordered glass. Score bars: engraved channel with gold fill animating on view; mono values right-aligned. Rubric rows: plaque rows — criterion, italic evidence quote + timestamp in --dim, level chip (steel/silver/gold) right. Advisor heatmap: readiness as metal finish per cell (raw steel → polished gold). Empty states: an unengraved blank medallion + one action line ("Upload your first run — leave with a score."). Voice: coach-like, concrete, zero "AI magic ✨", no emoji in product UI, sentence case.
11.7 Performance & quality floor (lag reads as cheap)
3D only in marketing hero + score reveal; lazy-loaded; Draco glTF ≤ 1.5MB; DPR cap 2; paused off-screen. LCP < 2.5s, CLS < 0.05, animate only transform/opacity, fonts system-first. Fully responsive to 360px; visible keyboard focus; reduced-motion respected. ffmpeg.wasm lazy-loaded ONLY on the judge page. First-load JS < 300KB per app route. Screenshot every new screen and self-critique against this section before marking a task done.
11.9 Product-UI baseline (the working-screens half)
Tailwind + shadcn/ui + lucide-react; brand primary indigo-600 (hover 700); zinc neutrals; radius rounded-xl cards / rounded-lg controls; shadow-sm, rely on borders; page padding p-6 desktop / p-4 mobile; 150ms ease transitions; skeletons over spinners. Dark mode via class strategy, default light. Org badge accents (generic only, no org logos anywhere): fbla=blue-600, deca=sky-600, tsa=red-600, hosa=rose-700, fpspi=violet-600.
11.8 UX rules
Every async view ships a skeleton + an empty state (copy in §15). Destructive actions require type-to-confirm (workspace delete) or a 5s undo toast (task delete). Mutations optimistic with rollback on error; error toasts use §15 copy, never raw error strings. Realtime: subscribe to tasks and gradings changes per open workspace. Mobile: board → swipeable columns, report tabs → accordion, wizard stays single-column. Accessibility: everything keyboard-reachable, focus rings on, explicit labels, drag-drop has a button-based "move to column" fallback, color is never the only signal (score chips include text).

§12 — PAGE-BY-PAGE FRONTEND
Authed shell: AppSidebar (Dashboard, Resources, Officer?, Settings, workspace list) + Topbar (breadcrumb, UsageMeter, UserMenu). Unauthed hitting (app) → redirect /login?next=… via middleware.
/ Landing (public, metal treatment): (1) Hero H1 "Practice like it's judgment day." / sub "Plan your prep, manage your team, and get judged by AI before the real judges ever see you — for FBLA, DECA, TSA, and HOSA." + "Start free" + "Watch the demo"; the medallion scroll moment lives here. (2) Three pillars: Plan / Learn / Perform. (3) "How the AI Judge works" — Upload your rubric → Upload your run-through → Get scored line-by-line + grilled with judge Q&A. (4) 30s demo video. (5) Social-proof strip (pilot quotes; hidden if empty). (6) FAQ (privacy, affiliation, cost). (7) Footer with the verbatim non-affiliation disclaimer (§20) + Privacy/Terms/GitHub.
/signup /login /invite/[token]: display name, email, password, grad year (2026–2031), required "I am 13 or older" checkbox; Google OAuth (collect missing fields in a post-OAuth modal). Invite: shows workspace + inviter; signed-out → auth first, then accept → redirect; expired token → friendly error.
/dashboard: "Welcome back, {first name}" + "New workspace"; workspace card grid (event, OrgBadge, CountdownChip, task progress x/y, Open) + NewWorkspaceCard; DeadlineList (next 5 incomplete tasks across workspaces); RecentGradingsList (last 3: score fraction, tier chip, relative time). Empty: "No workspaces yet — create one for your next event and we'll build your prep timeline automatically."
/workspaces/new (4-step wizard): (1) OrgPicker → EventPicker (searchable; "Can't find it? Create a custom event" → name + format radio with plain-language descriptions). (2) competition date (required, future); if prejudged_plus_presentation, optional prejudged deadline (defaults to comp − 21 days); autofill name "{Event} — {Month Year}". (3) invite emails (chips) → invites + copyable links. (4) review + "Create workspace" → inserts workspace + owner membership + template tasks (§13, back-scheduled, past-due clamped to tomorrow) → redirect with "Your prep timeline is ready" toast.
/w/[id] Overview: header (name, OrgBadge+event, CountdownChip — amber < 14 days, red < 7; second chip for prejudged deadline). MilestoneTimeline (horizontal stepper: done filled, next pulsing, future hollow, overdue red). "Next up" (3 soonest incomplete tasks, inline checkboxes). "Latest grading" (score, tier, top-3 priorities, View full report) or empty CTA. Team panel (avatars, owner crown, Invite).
/w/[id]/tasks: toolbar (Add task, AssigneeFilter, board/list toggle). Board = 3 TaskColumns (todo/in_progress/done) with counts; TaskCard (title, assignee avatar, DateChip, milestone star); dnd-kit + keyboard "move to column" fallback. TaskDialog CRUD with undo toast. List view sorted by due date. Realtime sync both views.
/w/[id]/judge (setup, two halves): Rubric — RubricSelector or RubricUploadButton → parse → RubricReviewModal (editable table: criterion, description, max points, add/remove rows, live sum vs detected total, warning on mismatch) → Confirm locks. Never grade on an unreviewed parse. Submission — tabs: Video (drop mp4/mov/webm ≤ 20 min → AudioExtractProgress via ffmpeg.wasm → upload mp3 → auto /api/transcribe; status chip uploaded→transcribing→ready; optional SlidesAttach PDF), PDF (ready immediately), Link (URL + fetch check). RunJudgeButton enabled when rubric confirmed AND submission ready; shows "{n} of 8 free gradings left this month". Running → GradingStatusPanel stages Transcribing → Judging → Writing Q&A (poll 3s). History: GradingHistoryTable + ScoreSparkline at ≥ 2 gradings on one rubric.
/w/[id]/judge/[gradingId] Report (the money screen — most design effort here): ScoreHeader (big "{total}/{max}" + %, delta vs previous ▲+7, medal tier chip, medallion reveal, criterion bar chart, timing chip red if over). "Fastest points" PriorityCallout — top-3 point_gaps_ranked as cards (criterion, +N pts, difficulty tag, fix). Tabs: Rubric feedback (CriterionCard per criterion in order: name, score/max + colored bar, ConfidenceTag when != high with tooltip "Visual criteria can't be fully judged from audio; attach your slides next run", justification, EvidenceQuote blockquotes with [mm:ss] chips, improvements bullets); Judge Q&A (grouped warmup/standard/hard; QAItem expands to "Why a judge asks this" + answer points; per-card "reveal hint" so teams practice first; footer "Practice these live" → Phase 3); Transcript (segment rows [mm:ss] + text, search). Footer: AccuracyRater (1–5 stars) → grading_feedback; after competition_date, RealScoreForm (real score + max + notes → the accuracy study).
/w/[id]/judge/[gradingId]/practice (Phase 3): one QuestionCard at a time; AnswerBox (1200-char cap) → TurnFeedback (1–5 dots, feedback, optional follow-up, max 2) → PracticeSummary (per-question scores, weakest flagged, "Re-run weakest 3").
/w/[id]/checklist: requirement rows — label, auto-flag pill (green PASS / red FAIL with measured value e.g. "22 pages / limit 20") recomputed per latest submission, manual checkboxes for the rest.
/officer: table (team, event, deadline, members, latest score, last activity), sortable; row → team detail (scores visible; recordings only if team toggled sharing). 403 page for non-officers.
/resources + /resources/[org]/[eventSlug]: OrgTabs → searchable EventGrid; event page header + format explainer + ResourceList grouped by kind (outbound links only), "Create a workspace for this event" CTA, SuggestResourceDialog (→ approved=false). Admin approval in Supabase Studio in v1.
/w/[id]/settings + /settings: workspace (owner-gated): rename, members + remove, pending invites + revoke, danger-zone delete (type-name-to-confirm). Account: display name, grad year, theme toggle, usage this month (n/8 + reset date), "Delete my account and all data" (service-role cascade).
/privacy /terms: static MDX per §20 required statements.

§13 — TASK TEMPLATE DEFINITIONS (lib/templates/taskTemplates.ts)
Templates are arrays of {title, description?, offsetDays, isMilestone} where offsetDays is relative to competition_date (negative = before). Generator: due = competition_date + offsetDays; if due < tomorrow, clamp to tomorrow; sort by due; all unassigned. prejudged_plus_presentation items marked (P) key off prejudged_deadline when it exists. Unit-tested (§15): counts per format, clamping, (P) keying, ordering, milestone flags.
presentation_qa (14): −42 Read the full guidelines + rubric together (M) · −38 Outline: thesis, section map, who says what · −35 Script v1 (M) · −31 Slides v1 · −28 First timed run-through (M) · −24 Self-score against the rubric line-by-line · −21 Revise script + slides · −17 Run-through #2 in front of someone outside the team · −14 AI mock judging #1 + review report (M) · −10 Fix top 3 priorities · −7 AI mock judging #2, target a higher band (M) · −5 Q&A drill on generated questions · −3 Final polish: timing, transitions, handoffs · −1 Logistics check: outfit, materials, room, arrival.
prejudged_plus_presentation (13): −56(P) Read guidelines + rubric (M) · −49(P) Report/asset outline approved · −35(P) Full draft v1 (M) · −28(P) AI mock judging on the draft + revise · −21(P) Final proofread + formatting · −14(P) SUBMIT prejudged materials (M, red) · then presentation: −12 Presentation script v1 · −9 First timed run (M) · −7 AI mock judging on presentation · −5 Fix top 3 priorities · −3 Q&A drill · −2 Final run-through · −1 Logistics check.
roleplay_interview (10): −28 Read guidelines + rubric; list the performance indicators (M) · −24 One-page frameworks cheat sheet for this cluster · −21 Practice scenario #1 aloud, self-record · −17 AI mock judging on scenario #1 (M) · −14 Practice scenario #2 with a 10-min prep cap · −10 AI mock judging #2 · −7 Drill weak indicators from both reports · −4 Full simulation: fresh scenario, real timing (M) · −2 Review indicator checklist · −1 Logistics check.
objective_test (8): −35 Collect study materials + past questions (M) · −30 Diagnostic practice test, score it (M) · −25 Study block 1: weakest domain · −18 Study block 2 · −11 Practice test #2 (M) · −7 Review every miss · −3 Light review, no cramming · −1 Logistics check.
Custom events use their chosen format's template.

§14 — SEED DATA (scripts/seed.ts, idempotent upsert on org_id+slug)
Orgs: fbla, deca, tsa, hosa, fpspi. ALL limits [VERIFY] against current-year official guides before seeding — they change yearly; orgs publish updates late summer. Format codes: p=presentation_qa, j=prejudged_plus_presentation, r=roleplay_interview, t=objective_test.
FBLA launch set (~20): Public Speaking (p), Impromptu Speaking (p), Sales Presentation (p), Intro to Business Presentation (p), Social Media Strategies (p), Data Analysis (p), Emerging Business Issues (p), Business Plan (j), Coding & Programming (j), Website Design (j), Mobile Application Development (j), Graphic Design (j), Broadcast Journalism (j), Digital Video Production (j), Electronic Career Portfolio (j), Job Interview (r), Future Business Leader (r), Marketing (t), Business Management (t), Intro to Business Concepts (t).
Later-org seeds (format taxonomy makes these cheap):
DECA (~12): Principles series — Marketing/Business Management/Finance (r), Sports & Entertainment Marketing (r), Marketing Mgmt & Entrepreneurship Team Decision Making (r), Innovation Plan / Start-Up Business Plan / Business Growth Plan / Integrated Marketing Campaign / Sales Project / Financial Literacy Project (j). (Retail Product Launch — SlimeShield-style — maps to j.)
TSA (~12): Prepared Presentation / Extemporaneous Speech / Debating Technological Issues (p), Video Game Design / Software Development / Webmaster / Data Science & Analytics / Audio Podcasting / Digital Video Production / Engineering Design / Board Game Design (j), Coding (t).
HOSA (~10): Health Education / Community Awareness / Public Health / Prepared Speaking (p), Medical Innovation / Research Poster (j), Job Seeking / Interviewing Skills (r), Medical Terminology / Behavioral Health (t).
FPSPI: Global Issues Problem Solving (written → j/prejudged track).
requirements jsonb examples:
json
"fbla-website-design": [{"id":"url-live","label":"Site URL loads publicly","auto":null},
  {"id":"time","label":"Presentation within time limit","auto":"duration","param":420}]
"deca-retail-product-launch": [{"id":"pages","label":"Within page limit","auto":"page_count","param":20},
  {"id":"title-page","label":"Title page matches format","auto":null},
  {"id":"file","label":"PDF format","auto":"file_type","param":"pdf"}]
qa_format prose per org (verbatim in the grading prompt), e.g. FBLA: "Judges ask questions for {{qa_time}} after the timed presentation; questions probe implementation decisions and understanding of the topic; all team members may respond." DECA roleplay/written styles differ — encode per event.
Rubric library. Collect the 10 launch-event PDFs week 1; parse via the pipeline itself (dogfood F3) week 2; hand-review each; store parsed pre-confirmed + source PDF in the rubrics bucket + source_url. Resources: seed 4–6 per org from Ronit's competition tracker workbook (official guideline pages, rating-sheet indexes, public past-winner showcases, prep guides) — quality over volume, links only.

§15 — TESTING, QUALITY, ERROR MATRIX, COPY DECK
Unit (Vitest): rubric Zod schemas (valid/invalid/edge: tiered points, missing totals) · grading post-validation (coverage repair, arithmetic overwrite, hallucination stripping with a planted fake quote, clamping) · taskTemplates (counts per format, past-date clamping, (P) keying, ordering, milestone flags) · usage.ts month-boundary counting · transcript formatter (mm:ss, segment joining) · checklist auto-flag logic · rate limiter.
Integration/E2E (Playwright against a seeded local Supabase; AI mocked via AI_MOCK=1 returning canned fixtures): signup → dashboard · wizard creates workspace with correct back-scheduled tasks · task drag persists + survives reload · rubric upload → review edit → save · full grading run renders report with all tabs · invite-link accept · RLS smoke: user B cannot fetch user A's workspace by direct URL (expect 404 view). Real-model quality is the eval harness's job (§10), not Playwright's. Save 3 real API responses as fixtures in week 2.
Manual QA (run fully in launch-prep week, spot-run weekly): new-user flow on desktop + phone browser · size-cap rejection · wrong file type · scanned-PDF rejection message · team-full join · wrong invite code · grade without confirmed rubric (blocked with reason) · over-limit grading (429 friendly message) · officer dashboard as member (403) · recordings-sharing toggle actually gates playback · account deletion cascades (verify rows gone).
AI regression: rerun the §10 eval set on ANY change to prompt, model string, or post-validation; commit results per prompt_version to docs/eval-results/.
Error matrix (I3):
Failure
User sees
System behavior
Video too long / wrong type
"Videos need to be under 20 minutes (mp4, mov, or webm)."
Reject client-side before extraction
ffmpeg extraction fails
"We couldn't process that video. Try re-exporting it as mp4."
Log + analytics event
Upload network drop
"Upload interrupted. Check your connection and try again."
Retry button
Whisper failure
"Transcription hit a snag. Retry?"
status=failed + fail_reason; Retry re-invokes /api/transcribe
Rubric parse → NOT_A_RUBRIC
"That PDF doesn't look like a scoring rubric. Upload the official rubric with point values."
No save
Scanned PDF
"This looks like a scanned PDF. Export a text-based PDF instead."
No save
Grading validation fails twice
"The judge stumbled on this one. Your grading credit was not used. Please try again."
status=failed; do NOT write a usage row
Usage limit
"You've used all 8 free gradings this month. Your limit resets on {date}."
429
Link unreachable
"We couldn't reach that URL. Double-check it or upload a PDF instead."
From /api/link-preview
Generic 500
"Something broke on our end. It's logged and we're on it."
Toast + logged error id

Copy deck (lib/copy.ts). Tier chip labels: Needs work / Regional-ready / State-ready / Nationals-ready (also the medal steel/silver/gold mapping). Loading stages: "Transcribing your run…", "Judging against the rubric…", "Writing your Q&A grill…". Empty states: dashboard, tasks ("A clear board. Add your first task or regenerate the template."), judge history ("No gradings yet. Upload a run-through and meet your toughest judge."), resources ("No resources yet for this event. Suggest one?"). Tone: direct, coach-like, second person, zero corporate filler, never shame ("Needs work" is the floor). No exclamation marks except the one-time first-grading confetti toast ("Your first verdict is in!").
Perf/a11y budgets: landing Lighthouse ≥ 90 perf / ≥ 95 a11y; app routes first-load JS < 300KB; report page renders 25-criterion rubrics without jank; keyboard-only pass on wizard, board, judge flow before launch.

§16 — DEVOPS, CI/CD, ANALYTICS
GitHub: private repo in a team org. Branch protection on main (PR + 1 review + CI green). Conventional commits. PR template: what / why / screenshots / AC-checklist. Each §17 milestone = one PR titled M{n}: {name}.
CI (.github/workflows/ci.yml): on PR → pnpm install → typecheck (tsc --noEmit) → lint → unit tests → build. E2E job on PRs labeled e2e (spins Supabase local + Playwright). Secrets never in CI (AI mocked).
Environments: Local = Supabase CLI (db + auth emulators) + pnpm dev. Preview = Vercel preview per PR → staging Supabase project. Prod = main → Vercel prod + prod Supabase (separate project). Migrations canonical in supabase/migrations, applied via supabase db push.
Ops: Supabase daily backups [VERIFY free-tier availability; else weekly pg_dump via Action]. Error tracking via logs + a ?debug admin page listing failed submissions/runs with error text (you'll live on this during beta). Budget: hard alerts at $25/mo each on Anthropic + OpenAI dashboards; weekly cost check against sum(grading_runs.cost_cents). Secrets hygiene: service role + API keys server-only; rotate if ever pasted.
Analytics (lib/analytics.ts, PostHog free tier). Events: signup_completed, workspace_created {org,format}, team_joined, rubric_confirmed {criteria_count,warnings}, submission_uploaded {type}, grading_started, grading_completed {pct_band,tier,confidence_low_count,delta,cost_cents}, grading_failed {stage}, qa_hint_revealed, task_completed, checklist_autoflag_fail {requirement}, accuracy_rated {stars}, real_score_entered, resource_clicked {org,event}, invite_accepted. No PII in event properties. These numbers ARE the portfolio/traction metrics — wire them from day one.

§17 — ROADMAP (summer sprint → fall pilot → season → 2027)
Calendar reality. FBLA chapters activate Aug–Sep; districts ~Nov 2026–Feb 2027; states ~Feb–Apr 2027; NLC Jun–Jul 2027. The full product can't ship before the season starts — so: trustworthy grader by end of summer → grader-first pilot with your own chapter in the fall → full workspace for district/state season → optional big public launch Aug 2027.
Two layers run in parallel: the engineering milestone track (M1–M13) and the calendar phase track (P0–P5). Milestones are PRs; phases are business gates.
Phase 0 — Validate before building (Weeks 1–3 · Jul 14–Aug 2)
W1 (day-level, carries the technical risk): Mon repo + Next 15 + Supabase project + schema.sql + Google OAuth working locally for all builders. Tue Vercel deploy + storage buckets + signed-upload flow (F4 upload path) + users/chapters bootstrap. Wed: verify ffmpeg.wasm audio extraction in the browser end-to-end — decide the §6 pipeline architecture TODAY based on the result. Thu Whisper integration → transcript stored with timestamps. Fri first grading call with a hand-written rubric JSON (skip parsing) → raw JSON on an ugly internal page. Weekend M1: Ronit uploads a past presentation recording and gets a scored JSON back. If M1 slips, everything stops until it's green. Parallel: co-builder collects the 10 rubric PDFs + drafts the events seed with [VERIFY] values resolved.
W2 — grading quality + GO/NO-GO: rubric upload→parse→review-table→confirm flow (F3) + Zod + quote-verification post-validation. Run the §10 eval protocol on 6–8 artifacts (hand-score them as a team). Build the grading result page in parallel with real outputs. Iterate the prompt daily. W3 GATE: show graded results to 3 advisors — ≥ 2/3 rate "feels like a real judge" ≥ 7/10. Fail → iterate prompts 2 more weeks before any further product code.
Phase 1 — MVP: The Grader (Weeks 4–8 · Aug 3–Aug 31) → ship before school
M2 Schema (full migration + RLS + buckets + idempotent seed; two-user SQL test proves cross-workspace reads return zero rows). M3 Auth (13+ gate, grad year, Google OAuth + post-OAuth completion, invite accept). M4 Workspaces + templates (wizard, taskTemplates all four formats + unit tests, dashboard, overview). M5 Task board (dnd-kit + keyboard fallback, CRUD + undo, realtime, MilestoneTimeline). M6 Rubric flow (a real FBLA PDF round-trips ≥ 90% correct before edits; NOT_A_RUBRIC path). M7 Submissions (ffmpeg.wasm lazy-load, audio upload, Whisper, PDF/link tabs, SlidesAttach, status chips; 7-min mp4 → timestamped transcript in < 2 min on a school laptop). M8 Grading (full pipeline + F4 post-validation + usage limits + GradingStatusPanel + report page D8; planted fake quote demonstrably stripped in a unit test). M9 Q&A (chained after grading; 8–12 questions, ≥ half targeting sub-85% criteria). Medallion built (critical path).
Phase-1 acceptance: upload→grade happy path e2e green; grade < 4 min; cost ≤ $0.30 avg logged; design passes §11 review. Definition of MVP done: a chapter member you didn't personally onboard signs in, joins a team, uploads a practice video, and gets a rubric-scored breakdown + Q&A in under 10 minutes — and the score is one you'd defend as a competitor.
Phase 2 — Full product + closed beta during real season (Weeks 9–20 · Sep–Nov)
M10 Eval harness (scripts/eval.ts + 6 seed cases + docs/eval-results, matches §10 pass bar). M11 Resources (all orgs browsable, unapproved suggestions hidden). M12 Landing + legal + polish (D1, privacy/terms, settings, usage meter, error toasts, empty states, mobile + keyboard pass, analytics; Lighthouse budgets; hallway test with a pilot user). Then F7 planner + F8 checklist + F10 advisor dashboard + notifications.
Onboard 3 pilot chapters (yours first) as members pick events — peak need = perfect timing. Weekly: watch replays, fix top friction, tune 2 rubrics from advisor overrides. W15–18 golden eval set: 60 videos × 2 human judges (~$2–3K). M3-gate: r ≥ 0.8 before widening access. GTM: 2 TikToks/week + 1 SEO event page/week.
M2 (business): Month 4 → 3 chapters, 100 members, 300+ grades, advisor NPS ≥ 40.
Phase 3 — District season expansion (Weeks 21–30 · Dec–Feb)
Open national self-serve signup (free tier). Launch Pro + Chapter pricing (§18). Advisor dashboard (roster, heatmap, overrides) + notifications/nudges. Catalog → 20 events. GTM: advisor-group content timed to district results ("didn't place? here's why, line by line"); officer ambassador program (free Chapter tier for a case study). M4: 25 chapters / 1,500 members by Feb. M13 (v1.5): practice mode + score sparkline + real-score form + PDF export.
Phase 4 — State season peak (Weeks 31–40 · Feb–Apr 2027)
Live practice mode (in-browser recording, real-time pacing/filler HUD, full grade after). State deadlines/variants for the top 5 states. Booth at 1–2 state conferences: live "get graded on the spot" station + leaderboard screen. M5: $2K seasonal MRR-equivalent, 10 paying chapters.
Phase 5 — Summer build + Season 2 (May–Aug 2027)
NLC presence (even guerrilla demos) → season-1 retro → DECA catalog + role-play simulator prototype + PWA → Aug 2027 full public launch, 2–3 CTSOs → first state-association partnership conversation.
Standing cadence: Mon 30-min sync (north-star metric, top friction, 3 priorities) · ship user-visible weekly · Fri 30 min reading advisor overrides + a demo. Update later.md. One owner per pillar (AI/backend, frontend/design, data/eval, growth). Budget through Apr 2027 ≈ $10–15K: hosting ~$50–150/mo · LLM/Whisper ~$100–400/mo at pilot scale · eval set $2–3K · 3D asset $1–3K (if commissioned) · conferences $1–2K/event · legal review $1–2K.

§18 — BUSINESS MODEL
Freemium; member-led growth; advisor/school-paid expansion. Season 1 goal is adoption, not revenue — keep the free tier generous until retention is proven.
Free: 1 event, 8 grades/month (pilot-generous; can tighten to 3/mo at scale), checklist, resource library.
Competitor Pro — $49/season (or $8–10/mo): unlimited grades, all events, trends, live practice mode.
Chapter — $399/season (school PO/invoice): Pro for all members, advisor dashboard + overrides, team workspaces, priority grading. CTSO chapters have fundraising budgets specifically for competition prep, and advisors expense from chapter funds.
State/District licensing (season 2+): one deal = thousands of seats.
Unit economics: ~$0.30 COGS/grade → Pro profitable well past a season of heavy use; soft caps (5/day) protect margin. TAM bottom-up: 2M members × $49 ≈ $98M + ~25K chapters × $399 ≈ $10M + licensing; adjacent (speech & debate, mock trial, teacher rubric-grading) much larger. The wedge is AI-graded performance assessment, broadly.

§19 — GO-TO-MARKET
Wedge: advisors are distribution, members are users. One advisor = 20–100 members; advisors stay, members churn yearly. Network order (ten real users at your school beat 1,000 landing-page visits):
Phase 1 — North Creek FBLA (early Sept): live demo at the first chapter meeting — grade a volunteer officer's real practice pitch on screen; the line-item breakdown appearing live is the whole pitch (pre-graded backup ready in case wifi/API fails). Make it an official chapter initiative through officer roles (this is the matured FBLAQuest/CompDeck concept). Advisor buy-in first, separately: 10-min demo + one-pager, framed "see every team's progress without watching 40 videos," explicit that recordings are private unless shared.
Phase 2 — Cross-CTSO at North Creek (Sept–Oct): same live-demo pitch to DECA, TSA, FPSPI chapters via existing memberships. The shared rubric library + format taxonomy make each org cheap to add.
Phase 3 — Washington state (Oct+): WA FBLA channels via the Industry Relations EC network; fall leadership conferences (hallway phone demos beat posts); direct advisor emails to 3–5 nearby chapters.
Phase 4 (only if 1–3 work): public landing push, FBLA/DECA prep Discords, Reddit.
Content engine (always-on): TikTok/Reels/Shorts grade-reveal medallion clips + "what judges actually look for in X" (CTSO TikTok is a real, underserved niche) · SEO: one deep page per event ("FBLA [event] rubric explained + free scoring tool") — hundreds of long-tail pages, near-zero competition · a free public "one grade, no signup" tool as top-of-funnel. Built-in virality: shareable AI scorecard/medallion image; team events force 2–5 users per signup — lean into team events in onboarding.
Advisor cold-email template (fill N and X with real PostHog/DB numbers before sending — no numbers, no email):
Subject: Free AI practice-judge tool for [CHAPTER] competitive events Hi [Name], I'm a junior at North Creek HS and an FBLA officer. We built a free tool our chapter uses to prep for judged events: members upload a practice presentation, and it scores them against the official rubric line-by-line and generates judge Q&A. [N] of our teams used it this fall; average improvement from first to final practice run was [X] points. 15-minute demo this week? — Ronit
Voice: competitive, respectful, coach-like, engineered, serious, championship — never "AI magic." "Know your score before the judges do."
Assets checklist (built in launch-prep weeks): landing page · 2-min demo video (script: 15s problem, 60s live grading run on a real presentation, 30s point-gaps + Q&A, 15s sign-in CTA) · advisor one-pager PDF (what it does, what data is stored, who sees it, cost: free) · privacy page.

§20 — LEGAL, PRIVACY, COMPLIANCE (serving minors in schools — do not skip)
Age/COPPA: require 13+ at signup (enforced), avoiding under-13 parental-consent complexity. FERPA + state student-privacy laws (SOPIPA, etc.) apply once advisors/schools are involved → real privacy policy, a data-processing agreement for schools, and a public commitment: student data never sold, never used for model training without an explicit consent flag. Long-term, sign the Student Privacy Pledge / register with SDPC (advisors check).
Video of minors = sensitive data. Original video is never stored — audio (mp3) only, extracted client-side. Audio/transcripts/scores encrypted at rest; raw assets auto-purged at 90 days (transcripts/scores retained); US-region storage; access limited to the student, their team, their advisor (recordings gated by the per-team opt-in toggle).
Trademarks: FBLA/DECA/TSA/HOSA/FPSPI are registered marks. Nominative use only ("prep for FBLA events", not "FBLA official"); no logos. Non-affiliation disclaimer in footer and on every grade report, verbatim: "Rubrix is an independent student-built practice tool and is not affiliated with, sponsored by, or endorsed by FBLA, DECA, TSA, HOSA, or FPSPI. AI practice scores are estimates for preparation only and do not predict official results."
Rubric IP: official rating sheets are the orgs' IP. Safest path: users upload their own rubric for personal-use grading, and the library links to official sources rather than republishing. Restructure criteria into original JSON; never republish rubric PDFs/text wholesale. Chapter-internal practice use is study-guide territory; before any multi-school push, email the state advisor for a blessing (good politics either way). Pursue official partnership long-term; launch cleanly third-party.
AI disclosure in-product on every result screen: "AI practice feedback — not official judging. Real scores will differ."
School network reality: test on school wifi in September; some districts filter aggressively — keep the mobile-browser path as fallback.
Deletion: self-serve account + data deletion (service-role cascade, verified in QA). Termly-generated privacy/terms reviewed against the D12/§12 required statements by an adult/advisor.

§21 — PITCH DECK (13 slides; render in the §11 metal system when raising)
Title — logo, "Know your score before the judges do." Sub: the AI-graded competition workspace for CTSOs, starting with FBLA.
The world — 2M+ CTSO competitors; events judged on published rubrics. Anchor: "debate-team-meets-Shark-Tank, at national scale, in almost every high school."
Problem — real scored feedback once a year, at the competition; 1 advisor : 100+ students; prep in group chats. (Verbatim advisor quote from interviews.)
Insight — a rubric turns "give me feedback" into a bounded, gradeable AI task. Why now: frontier multimodal models × a market literally defined by rubrics.
Product — 30-sec demo: upload → evidence-cited breakdown → top-3 fixes → trend → medallion reveal. (Grade a 60-sec clip live if possible.)
How it works — one pipeline diagram + the credibility number: r ≥ 0.8 vs human judges on the golden set.
Moat — rubric-library depth · calibration dataset from overrides + real scores · chapter network effects · community brand. ("Why can't ChatGPT do this?" → no rubric structure, no pipeline, no calibration, no advisor layer; generosity-biased scores are worse than none.)
Traction — chapters, members, graded attempts, % with 2+ attempts, advisor NPS, one outcome story ("62 → 84 in 5 attempts; placed at districts"). Usage intensity > user count.
Market & model — $98M member layer + $10M chapter layer + licensing; wedge into AI-graded performance assessment broadly.
GTM — season-synced: officers + advisor groups → grade-reveal TikToks + long-tail SEO → conference grading stations. CAC ~0 in pilot; team events pull 2–5 users/signup.
Team — FBLA insiders who built the pipeline; explicit plan to go full-time on funding.
Ask — $350K pre-seed, 18 months: 60% founders full-time + 1 eng, 20% GTM, 10% eval data, 10% infra/legal. Buys: 3 CTSOs live, 200 chapters, ~$250K ARR-equivalent by end of season 2, one state partnership.
Close — medallion full-bleed: "Every student deserves a judge before judgment day." Appendix: eval methodology + accuracy table · unit economics · privacy posture · competitive matrix · seasonality cash-flow.
Portfolio deliverables (this doubles as a college/portfolio capstone): live product, GitHub org with real PR history, 2–3 min demo video, a technical write-up on the pipeline (§9 F3/F4 + §10 make great material), usage numbers from §16, per-member contribution summary, and the capstone research artifact — the AI-vs-real-judge agreement study built from grading_feedback (correlation + per-criterion error analysis).

§22 — MILESTONES, METRICS, RISKS
Milestone
When
Metric of truth
M1 Grader works
Week 1 weekend
You trust it on your own event
MVP done
End of summer (Aug 31)
An un-onboarded member: signup → team → upload → defensible grade + Q&A in < 10 min
M2 Pilot live
Month 4
3 chapters, 100 members, 300+ grades, advisor NPS ≥ 40
M3 Eval-validated
Month 5
r ≥ 0.8 vs human judges
M4 Season traction
Feb 2027
25 chapters, 1,500 members
M5 Revenue
Apr 2027
$2K seasonal MRR-equiv, 10 paying chapters
M6 Season 2
Aug 2027
2–3 CTSOs, 200 chapters, state partnership signed

North star: weekly graded attempts per active team. Supporting: weekly active teams (not users) · grading runs per active team per week (< 1 = product is dead) · repeat-grade rate (% teams with ≥ 2 runs on one event) · score delta run-1 → latest (health metric and the marketing stat) · funnel signup → team → confirmed rubric → first upload → first completed run (fix the biggest drop-off each beta week). Qualitative gate: after 2 beta weeks, ask 5 users "what would you be annoyed to lose?" — if nobody says the AI judge, stop and rethink. Phase gate for scaling: 5+ experienced competitors say the feedback beats advisor feedback.
Risk
L
Mitigation
Scores feel wrong → trust collapses
High
Eval gate (r ≥ 0.8) before launch; temp 0–0.2, canonical rubric JSON; evidence shown on every line; quote verification; 3-run median; advisor overrides; "beta"/"practice estimate" labeling; feedback button on every grade
Transcript-only grading misses delivery
Certain
Say so in UI; deterministic timing/pacing metrics in code; modality-honesty confidence flags; delivery/vision analysis is Phase 3
Serverless limits break the video pipeline
Medium
Audio extraction client-side (ffmpeg.wasm); decided Wed of week 1; fallback ladder in §6
Rubric PDFs parse badly
Medium
Mandatory human review table; library covers common events
FBLA/orgs object
Medium
Complementary positioning, disclaimers everywhere, user-upload rubric model, pursue partnership early
Seasonality (Mar–Aug cliff)
High
Season/annual chapter pricing; summers = build + officer-training content; DECA overlap
Generic AI tool clones it
Medium
Moat = rubric depth + calibration data + chapter network + community brand
4-org content bloat
Medium
Format taxonomy + links-only rubric model
School sales slow
Medium
Member-paid Pro keeps revenue flowing while POs close
API cost spike
Low
Per-category calls, caching, soft caps, cheaper model for consistency reruns, budget alerts, per-run cost logging
Team burnout / co-builder bandwidth
Medium
MVP scoped for solo-finish-ugly; week-1 ownership doc; weekly syncs; cut features not deadlines


§23 — THIS WEEK (immediate actions)
Prove the magic first. Build the throwaway grading pipeline (one video → ffmpeg.wasm audio → Whisper transcript → per-criterion Claude call → graded JSON) and run it on 3 real recordings before building any product UI. This is M1 and it gates everything.
Hand-structure 3 rubrics (Public Speaking, Sales Presentation, Business Plan) into the §9.3 RubricJSON and validate grading quality on those 3 videos.
Interview 5 advisors + 10 competitors; capture verbatim pain quotes (they become landing copy and Slide 3). Confirm they'd upload practice videos and which 5 events matter most.
Claude Code: scaffold the monorepo (§6), ship auth (Google SSO, 13+ gate) + Supabase schema + RLS + the FBLA event catalog skeleton (M2/M3 groundwork).
Lock the name (validate trademark + domain: Rubrix · Medalist · Gavel · TopSeed · JudgeReady — sounds like winning, not like AI) and register everything.
Resolve [VERIFY] values — pull current-year FBLA event time limits, page limits, team sizes, and Whisper/Claude pricing; hardcode pricing constants with source-URL comments.
Start the medallion 3D asset — it's on the brand's critical path.
Anything not in this doc goes in later.md, not the sprint. Scope is law. Lock in.

