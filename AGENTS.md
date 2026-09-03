# DreamCar Team Hub

Internal platform for the DreamCar team: SMM (`/hq/`), retention broadcasts, tasks, projects, onboarding, orgchart, survey, marketing research, regulations, health. Vanilla-JS static site on GitHub Pages served from the repo ROOT (`team.dreamcar.ua`) + Supabase HQ (`wotghlaehnvxyeacznvv`: Postgres 17, ~65 edge functions, 30+ pg_cron jobs) + 20 GitHub Actions + `@dreamcar_team_bot`. Public repository — see Rules.
Memory carrier: `github.com/dreamcarua/dreamcar-team` (this repo), folder `docs/`.
Project hub: `github.com/dreamcarua/dreamcar-memory` — project-level memory (launches, marketing, strategy, team, decisions). This repo's `docs/` is about this codebase only.
Owner: Vadym (vg@abrisart.com). Tasks are closed by whoever set them; we hand over.

## Rules

- Talk to the user in Ukrainian (or the language they write in). Dates DD.MM.YYYY, time CET/CEST.
- Wording in any DreamCar-facing text: never «розіграш», «лотерея», «квиток», «шанс» — legal risk, there is no licence. Write «учасники», «токени ШІ-сервісу», «автомобіль вручається серед учасників».
- Do on your own: frontend and workflow edits, migration files under `hq/db/migrations/`, edge-function code under `hq/supabase/functions/`, commits to a branch.
- Always ask first: money, ad budget, any broadcast that reaches the participant base (30–40k people), repository visibility, rotating any key, deleting an edge function or a pg_cron job.
- Never: commit secret values, `.env`, chat ids, hosts, IPs or personal contacts — this repo is PUBLIC. Write "see GitHub secrets / Supabase Edge secrets" instead.
- Secrets never go into this repo. `docs/tooling.md` says where they live, not what they are.
- The site is published from the repo ROOT: every file added here appears on team.dreamcar.ua.

## Entry — before the first action that changes project state

Chat without a folder? Nothing was loaded automatically: fetch this file and `docs/` from the carrier first.

1. `docs/tasks.md` — what is open, what is handed over and waiting, where the next move is ours.
2. `docs/handoff.md` — not empty means a previous session stopped mid-task. Continue, do not restart.
3. `docs/traps.md` — before the first edit of code, workflow, SQL or config. Always.
4. `docs/tooling.md` — before using any tool, MCP, workflow, bot, database or account of this project.
5. Recent commits — `survey: auto-update` and `archive cowork-notify` are bots; a human or agent commit in the last hours means someone else is working here.
6. Related carriers (below) — the task touches launches, marketing, participants, money or people beyond this codebase → fetch `AGENTS.md`, `docs/tasks.md`, `docs/decisions.md` from the project hub too, before deciding anything.

Say one sentence: how many tasks are open, which are on us, what you start with. If a move is ours, say that first, even if asked about something else.

A task you were just given goes into `docs/tasks.md` now, verbatim, with the author's name. Before starting it, check it is not already done in the code.

## Context loss — when you can no longer quote the original task verbatim

You detect this yourself; nobody will tell you. Your context was compacted. Before the next action re-read `docs/handoff.md` and `docs/tasks.md`. Do not trust the summary for paths, numbers or what is already done; re-read the file.

## Checkpoint — during long tasks

Automatic. The user never asks for a checkpoint and is never reminded to.

After each completed step of a multi-step task and before any long operation: rewrite `docs/handoff.md` (task verbatim, done, not done, next action, numbers with sources). Rewrite, do not append. Empty it when the task is handed over.

## Pre-flight — before an irreversible action, money, or a shared resource

Answer out loud in the reply. No answer to a line = no action.

1. WHOSE. Who else changes this? Are there commits in the last hours that are not mine? Is a pg_cron job or an edge function already doing it?
2. SOURCE. Number · source · date. Primary source (Supabase SQL, `cron.job_run_details`, `gh run list`, Meta Ads Manager) or a convenient sample?
3. WHOLE. The population or the first N rows? PostgREST caps at 1000 rows — did I paginate, did I ask the system for the total?
4. WORST. Which single check, if it came out differently, would cancel this? Do it first.
5. ROLLBACK. Exact command. Backup made and verified. For SQL: the reverse migration is written before the forward one runs.

## Exit — automatic, before the word "done"

You run this unasked, every time a task changed project state — the user does not say "Exit" and does not remember these files exist. Also run it when the user says the task is finished, changes subject, or leaves; a task interrupted mid-way gets a Checkpoint instead.

1. What did I learn about this project? → `docs/traps.md`, `docs/tooling.md`, `docs/architecture.md`
   Learned about the business rather than this codebase (market, participants, a launch, a decision of Vadym's) → the project hub `dreamcar-memory/docs/`, via the GitHub tool, not here. One fact lives in one place.
2. What did I decide and why? → `docs/decisions.md`
3. What is left open, including side findings nobody asked for? → `docs/tasks.md`
4. Can the owner see the result without effort? If not: screenshot, preview or link with the handover.
5. Report through the project channel → `docs/tooling.md` → Reporting.

Records go in the same commit as the change. Hand over now, in this reply. A line leaves `tasks.md` when its author confirms, not when the work is done.
Two people ask for opposite things: pick one, name the conflict, tell Vadym.

## Map

| File | What | Read when |
|---|---|---|
| `docs/tasks.md` | open tasks, handed-over-and-waiting | entry. Always |
| `docs/handoff.md` | mid-task state of the last session | entry; after context loss |
| `docs/traps.md` | traps of this project | before the first edit. Always |
| `docs/tooling.md` | workflows, bot, Supabase, Meta, secret names, entry patterns, reporting | before using any tool |
| `docs/architecture.md` | sources of truth, trigger channels, ownership, logs, fallbacks | before touching a shared resource; when diagnosing |
| `docs/decisions.md` | why it is this way | before changing something agreed |
| `docs/open-questions.md` | blocked until a human decides | before talking about plans |
| `docs/personal.md` | who asks for what, who accepts it | before promising anything to a person |
| `onboarding/CRON_JOBS.md` | pg_cron registry (as of 07.06.2026 — verify in SQL) | before adding or changing a cron job |
| `onboarding/TROUBLESHOOTING.md` | 15 diagnosed production incidents with SQL and curl | when something is broken |
| `onboarding/SECRETS.md` | what each secret is for and how to rotate it | before touching credentials — but see traps.md on its names |
| `onboarding/CHANGELOG.md` | daily changes, 1975 lines, newest on top | when you need the history of a decision |
| `AUDIT_BACKLOG.md`, `onboarding/BACKLOG_2026-08.md` | security and product backlog | before proposing new work |

## Related carriers — the same project, other repositories

One project = one hub (`dreamcar-memory`: launches, marketing, strategy, people, decisions) + N code repositories, each with its own memory about its own code. A fact lives in exactly one of them.

| Carrier | What it is | Read its `AGENTS.md` + `tasks.md` when |
|---|---|---|
| `github.com/dreamcarua/dreamcar-memory` | project hub: launches, marketing, strategy, team, decisions | the task goes beyond this codebase |
| `github.com/dreamcarua/dreamcar-dashboard` | ETL, analytics, ads automation, `dashboard.dreamcar.ua` (memory v8 in `memory/`) | the task touches numbers, ads, ETL, the dashboard |
| `github.com/dreamcarua/brand-book` | brand assets, `global-header.js` used by this site | the task touches the shared header, fonts or colours |

A task that spans two carriers: one line in each `tasks.md`, each pointing at the other.

## Overrides of global rules

| Global rule | Here | Why | Since |
|---|---|---|---|
| "commit on your own to dreamcarua/*" | this repo takes a branch + owner merge, not direct pushes to `main` | public repo, bots commit here several times a day, and every root file is instantly live on team.dreamcar.ua | 03.09.2026 |
