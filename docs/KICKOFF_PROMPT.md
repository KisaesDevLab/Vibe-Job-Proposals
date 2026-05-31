# KICKOFF — Autonomous Build (Darrow Time & Invoicing)

You are building a complete, production-ready web application **autonomously and unattended**. The operator is not available to answer questions. Do not stop to ask anything. Work continuously from Phase 1 through Phase 20 until the smoke test passes.

## Your source of truth

- `CLAUDE.md` at the repo root is the full 20-phase build plan (~575 numbered tasks with acceptance criteria). Read it completely before writing any code, then execute it phase by phase in order.
- `docs/mockup.html` is the visual/UX reference for the UI. Match its information architecture, view layout, terminology, and the charcoal + copper aesthetic. It is a static mockup — the real app is React per the stack in CLAUDE.md §1; reproduce the *look and structure*, not the literal HTML.
- `Time_Allocation_Tracking.xlsm` (place at `packages/db/test/fixtures/` if present) is the legacy workbook the Phase 18 importer must parse and the integration tests run against. If it is not present, build the importer to the spec anyway and write its tests against a small synthetic fixture you generate, noting this in QUESTIONS.md.

## Non-negotiable working rules

1. **Never block on the operator.** When you hit any ambiguity, missing detail, or design fork not fully specified in CLAUDE.md: pick the most reasonable default consistent with the rest of the plan, **append an entry to `QUESTIONS.md`** (question, the decision you made, your reasoning, and which files it touched), and keep going. Do not pause, do not wait, do not ask in chat.
1. **One phase at a time, in order.** Complete a phase fully — including its tests and acceptance criteria — before starting the next.
1. **Commit per phase.** After each phase passes, commit with `feat(phase-N): <title>` and a body summarizing what was built and any QUESTIONS.md decisions made in that phase.
1. **Green gate between phases.** After each phase run `npm run lint`, `npm run type-check`, and `npm test`. Do not advance while any are failing — fix forward until green. If a test is genuinely blocked by something out of scope, mark it `test.skip` with a `// PHASE-N: <reason>` comment and log it in QUESTIONS.md, then continue.
1. **Migrations are committed.** Generate and commit Drizzle migration SQL with every schema change; never hand-edit applied migrations.
1. **Update docs at the milestones** named in CLAUDE.md §6 (README after Phases 1, 2, 18, 20; PLACEHOLDERS.md in Phase 14; OPERATIONS/BACKUP/UPGRADE in Phase 20).

## Defaults to assume (so you don’t have to ask)

- Stack, naming, license, env vars, and conventions exactly as written in CLAUDE.md §1. Do not substitute libraries unless one is unavailable, in which case pick the closest equivalent and log it.
- Single-tenant, admin role only for v1, owner role stubbed (enum present, no owner UI).
- Currency USD, no sales tax, timezone `America/Chicago`.
- Where CLAUDE.md and the mockup disagree, CLAUDE.md wins for behavior/data, the mockup wins for layout/wording. Log the conflict.
- Seed data: use the values shown in the mockup and CLAUDE.md seeds (the 9 customers, rate levels, default markups, etc.).
- Bootstrap admin credentials for local/dev: username `admin`, a random strong password printed to the console and written to `docs/FIRST_RUN.md` (gitignored). Never commit real secrets.

## Definition of done

- All 20 phases complete, each committed.
- `docker compose -f docker/docker-compose.prod.yml up` brings up a working app; `/api/health` returns all deps up.
- The Phase 20 smoke test (`docs/SMOKETEST.md`) passes end to end: bootstrap admin → log in → create customer + rate schedule + employee + cost rate → enter time on the weekly grid → log an expense with an image attachment that converts to PDF → create an invoice draft → finalize (docx + pdf generate) → download both → void and re-issue → run all three reports → check the Readiness dashboard.
- The Phase 18 importer runs against the provided xlsm (or synthetic fixture) and produces `docs/sample-import-report.md`.
- `QUESTIONS.md` contains every decision you made unattended.
- A final commit `chore: v1.0.0` after the smoke test passes, and `docs/smoketest-results-v1.0.0.md` written.

## First actions, right now

1. Read `CLAUDE.md` and `docs/mockup.html` in full.
1. Create `QUESTIONS.md` with a header and start logging.
1. Begin Phase 1, Task 1, and proceed continuously.

Build the whole thing. Make every reasonable decision yourself, record it, and don’t stop until the smoke test is green.