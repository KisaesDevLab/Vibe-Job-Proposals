# QUESTIONS & Autonomous Decisions Log

This file records every decision made unattended during the autonomous build,
per the KICKOFF rules. Format: **Question / Ambiguity** → **Decision** →
**Reasoning** → **Files touched**.

---

## Phase 0 — Environment & global decisions

### Q0.1 — Package manager: pnpm vs npm
CLAUDE.md §1.2 says "npm workspaces" but a couple of tasks mention `pnpm bootstrap` /
`pnpm db:reset`.
**Decision:** Use **npm workspaces** (the §1.2 authority) for everything; provide the
documented scripts under npm (`npm run bootstrap`, `npm run db:reset`).
**Reasoning:** §1.2 is the explicit layout spec; the `pnpm` mentions are incidental.
**Files:** root `package.json`.

### Q0.2 — Node version
CLAUDE.md says Node 20; the container ships Node 22.22.
**Decision:** Target Node 20 syntax/features but run on the installed Node 22 (backward
compatible). `engines` set to `>=20`.
**Reasoning:** Node 22 runs all Node 20 code; can't change the container runtime.
**Files:** root `package.json`.

### Q0.3 — Migrations: drizzle-kit generated vs hand-written numbered SQL
CLAUDE.md §1.3 requires migration files numbered `0001_*.sql` etc.
**Decision:** Author **hand-written numbered SQL migrations** applied by a small
idempotent runner (`packages/db/src/migrate.ts`), and keep the Drizzle schema in TS for
type-safe queries. Drizzle-kit `generate` is not used as the source of truth.
**Reasoning:** Gives full control over Postgres-specific features (exclusion constraints,
citext, partial unique indexes, CHECK) that drizzle-kit doesn't always emit cleanly, and
matches the explicit numbering convention.
**Files:** `packages/db/migrations/*.sql`, `packages/db/src/migrate.ts`.

### Q0.4 — Local services
Docker daemon is not available in the build container (DinD off), but Postgres 16 and
Redis 7-equivalent binaries are installed.
**Decision:** Run Postgres and Redis as native services for dev/test/smoke; ship the
docker-compose files for real deployment as specified.
**Reasoning:** Can't run Docker-in-Docker here; native services give an equivalent runtime
for verifying the app and the smoke test.
**Files:** none (runtime only); compose files still authored per Phase 1/20.

### Q0.5 — Legacy xlsm fixture not present
`Time_Allocation_Tracking.xlsm` is not in the repo.
**Decision:** Build the importer to spec and generate a **synthetic xlsm fixture** with
`exceljs` that mirrors the documented sheet layout (Companies, Defaults, Employee Active,
Job Codes, Time Recap, Billed, Import From AW), and run importer tests against it.
**Reasoning:** KICKOFF §9 explicitly authorizes a synthetic fixture when the workbook is
absent.
**Files:** `packages/db/test/fixtures/make-fixture.ts`, importer tests.

---

## Phases 1–15 (backend + workers)

### Q1.1 — Express/session CSRF approach
CLAUDE.md Phase 20 calls for CSRF protection via SameSite cookie + custom header.
**Decision:** Require an `X-Requested-With: darrow` header on all mutating requests
(POST/PUT/PATCH/DELETE) except `/api/auth/login`. The SPA sets it globally.
**Reasoning:** Simple, dependency-free, works with cookie SameSite=lax.
**Files:** `apps/api/src/app.ts`, web `apiFetch`.

### Q1.2 — `getCostRateAt` "day before" auto-close
Phase 5 task 9 says auto-close prior open rate by setting `effective_to = effective_from`
of the new rate (half-open intervals, so the new row starts exactly where the old ends).
**Decision:** Set previous `effective_to = new.effective_from` (no -1 day), consistent with
the `[from, to)` half-open convention used everywhere.
**Files:** `apps/api/src/routes/employees.ts`.

### Q1.3 — LibreOffice / `libreoffice-writer` missing in dev container
The dev container shipped `libreoffice-core` but NOT `libreoffice-writer`, so every
docx→pdf conversion failed with "source file could not be loaded".
**Decision:** `apt-get install libreoffice-writer` in the dev container; the production
Dockerfile already lists `libreoffice-writer` (Phase 1/20), so prod is unaffected.
**Reasoning:** Writer provides the docx import filter required by `--convert-to pdf`.
**Files:** docker/Dockerfile (already correct); logged here for the dev runtime.

### Q1.4 — multer 1.x vulnerability warning
npm flags multer 1.4.5-lts as vulnerable; 2.x has API changes.
**Decision:** Keep multer 1.x for now (memory storage, size-capped, single-tenant
internal app); revisit in a maintenance pass. Logged as known.
**Files:** apps/api/package.json.

### Q1.5 — Background HTTP servers killed by the build sandbox
Long-running detached servers receive SIGTERM when a tool call ends, so end-to-end
verification uses in-process service calls (and, for the green gate, supertest), not a
persistent server. Production uses the normal long-running server via entrypoint.sh.

### Q2.1 — Void sequence numbering: CLAUDE.md internal contradiction
Phase 13 task 3 sample SQL computes the next sequence with `WHERE status != 'void'`,
but Phase 16 acceptance ("Sequence numbers skip voided invoices" / task 13 "voided
invoice's sequence number not reused" / E2E "re-finalize → new sequence number") requires
the opposite.
**Decision:** Compute `MAX(sequence_number)` over **all** invoices for the job (including
void) so a voided `.01` is retained and a reissue becomes `.02`. The acceptance criteria
and E2E test govern behavior over the sample SQL snippet.
**Files:** `apps/api/src/services/invoice.ts`.
**Verified:** smoke test reissue yields sequence 2.

### Q2.2 — Programmatic smoke test
Phase 20 SMOKETEST is documented as a manual checklist; I also implemented it as a
single-process automated script (`scripts/smoke.ts`) that boots the API + BullMQ workers
in-process and drives the entire lifecycle over real HTTP. This is how the build verifies
the app (the sandbox kills detached servers). `docs/SMOKETEST.md` documents the manual
steps; `npm run smoke` runs the automated equivalent.
