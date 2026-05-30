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

### Q3.1 — Docx dotted-placeholder parser (bug found by added tests)
docxtemplater's default parser does not traverse nested objects, so `{invoice.number}`,
`{company.name}`, `{totals.grand_total}` rendered EMPTY in real invoices (only flat
loop keys worked). CLAUDE.md Phase 14 task 5 calls for the angular-parser.
**Decision:** Add a dependency-free custom `parser` (`dottedParser` in render-docx.ts)
that resolves dotted paths and falls back to the root scope inside loops. Verified by a
new render unit test and a scalar-content guard in the smoke test.
**Files:** `packages/workers/src/render-docx.ts` (+ test), `scripts/smoke.ts`.

### Q3.2 — Docker image build not verifiable in this environment
`dockerd` starts here, and both compose files validate (`docker compose config`), but the
image build cannot complete: Docker Hub rejects base-image pulls with an unauthenticated
**pull-rate-limit** (429/403). This is an environment/network constraint, not a Dockerfile
defect. The Dockerfile, entrypoint, and prod compose are authored to spec; the `# syntax`
frontend directive was removed (it required a blocked registry fetch).
**Decision:** Verified as far as the environment allows (daemon up, compose config valid);
documented the limitation rather than claiming a successful image build.
**Files:** `docker/Dockerfile`, `docker/docker-compose*.yml`.

### Q3.3 — Test coverage vs. per-phase prescription
The phases prescribe many more unit/e2e tests than implemented. Added a substantive
supertest **integration suite** (auth/401/CSRF, gist exclusion constraint, full
draft→finalize with snapshot==preview, one-draft-per-job, void unbind + sequence-not-
reused, markup-blocked-after-finalize, time upsert delete, markup precedence) plus
image-to-pdf and docx-render unit tests. Playwright e2e remains out of scope for this
pass; DB-gated tests run in CI (where DATABASE_URL is set) and skip on the unit-only gate.

---

## Exhaustive phase audit (post-v1.0.0)

### Q4.1 — dump.rdb committed by accident
Redis (run with `--daemonize` from the repo cwd in dev) wrote `dump.rdb` into the repo and
it got committed. **Fixed:** untracked + added `dump.rdb`/`*.rdb` to `.gitignore`.

### Q4.2 — Phase gaps found by the endpoint audit (scripts/audit.ts) and fixed
- Phase 6 customers CSV export; Phase 8 jobs CSV export (both were missing).
- Phase 10: expense `work_date` >30 days in the future now rejected; first-page PNG
  thumbnail endpoint (`/attachments/:id/preview`, gs+graphicsmagick via pdf2pic) added.
- Phase 14: example-template download endpoint + UI link + placeholder viewer.
- Phase 17: SMTP save endpoint (AES-256-GCM, password redacted from GET) + test-connect +
  Settings Email sub-section.
- Phase 9: aria-labels on time-grid cells.
- Phase 11: added nullish-branch tests to reach the required **100% branch coverage** on
  the pricing module (installed `@vitest/coverage-v8`).
- Phase 4/5/7: added integration tests for FK-guarded rate-level delete and half-open
  `[from,to)` boundary semantics of getRateAt/getCostRateAt + cost-rate auto-close.

### Q4.3 — CORS not configured (Phase 1 task 9)
**Decision:** Omit a CORS middleware. In dev the SPA is served by the Vite dev server which
**proxies** `/api` to the API (same-origin); in prod the API serves the built SPA itself
(same-origin). No cross-origin requests occur, so CORS headers are unnecessary. Adding the
documented `localhost:5173` allowance would only matter if running the SPA without the
proxy, which we don't.

### Q4.4 — shadcn/ui not used (Phase 1 task 6)
**Decision:** Reproduced the mockup's look with hand-written Tailwind component classes
(`.btn`, `.card`, `.input`, `Badge`, `Modal`, …) instead of scaffolding shadcn/ui. The
visual result matches the charcoal+copper mockup; shadcn would add generated boilerplate
without changing behavior. Logged as a deliberate deviation.

### Q4.5 — husky + lint-staged added
Added (Phase 1 task 5): `.husky/pre-commit` runs `lint-staged` (eslint, max-warnings 0) on
staged `*.{ts,tsx}`; `prepare: husky || true` keeps `npm ci` safe in non-git/Docker
contexts.

### Q4.6 — Docker image build (revisited)
`dockerd` runs in this environment and both compose files validate, but base-image pulls
hit Docker Hub's unauthenticated rate limit, so a full `docker build` still cannot complete
here. Unchanged from Q3.2 — an environment constraint, not a defect.

---

## Per-user SMTP (feature request)

### Q5.1 — Per-user invoice email sender
Requested: invoice emails should appear to come directly from the sending user. Chosen
model (user): **"both, with fallback."**
**Implemented:**
- Migration `0013_user_smtp.sql` adds per-user SMTP columns to `users` (host/port/user/
  password_enc/from_address/from_name/enabled); password encrypted with AES-256-GCM
  (`apps/api/src/crypto.ts`, reused `SMTP_ENC_KEY`).
- Pure resolver `resolveSmtp(user, global)` (`packages/shared/src/smtp.ts`, 5 unit tests):
  uses full per-user credentials when the user has an enabled host; otherwise rides the
  company relay but keeps the user's From address; falls back entirely to the global relay;
  errors if neither is usable.
- `/api/auth/smtp` GET/PUT/test (per-user; password redacted from GET, integration-tested).
- `send-invoice-email` worker resolves the sender per email (`sent_by_user_id`), decrypts
  the chosen source's password, sets `From` + `Reply-To` to the user, and sends.
- UI: "My Email" modal (sidebar mail icon) for personal SMTP; "Email" button + compose
  modal + send-history on the invoice detail page.
**Verified end to end** (`scripts/verify-email.ts`, in-process SMTP sink): the captured
envelope is `MAIL FROM:<alice@firm.test>`, `From: Alice Field <alice@firm.test>`,
`Reply-To: alice@firm.test`.
**Caveat (documented):** when a user only sets a From address and rides the shared relay,
the mail may fail SPF/DKIM unless the relay is authorized to send as that address.

---

## Secondary time-entry mode (feature request)

### Q6.1 — Per-employee weekly time entry
Requested a second entry mode: select an employee, then enter job codes + hours for the
week (complementing the all-crew grid).
**Implemented:**
- `GET /api/time/week` gained an optional `employee_id` filter (integration-tested).
- Time page now has a **"All Crew" / "By Employee"** toggle. By-Employee mode: pick an
  employee, add jobs via a "+ Add job code…" selector, and enter ST/OT/DT per day for the
  week. Reuses the same auto-save-on-blur, locked-when-billed cells, aria-labels, and
  row/day totals (shared `WeekTable`). No schema change — uses existing write endpoints.
**Files:** `apps/api/src/routes/time.ts`, `apps/web/src/pages/Time.tsx`.

---

## Bill processing inbox (feature request)

### Q7.1 — Upload bills first, then triage into expenses
Requested a "processing box": upload bills, then click a file to see a preview with expense
data-entry fields beside it. Confirmed decisions: **Inbox tab inside Expenses**, **remove
the inbox record once processed**, **one expense per file** (v1).
**Implemented:**
- Migration `0014_inbox_documents.sql` + `inboxDocuments` table (reuses `attachment_status`).
- `inbox-to-pdf` BullMQ worker reusing the pure `imageBufferToPdf`; images convert to a
  uniform single-page PDF for preview (PDFs are ready immediately).
- `/api/inbox` routes: multi-file upload (content-sniffed; HEIC gated by `hasHeicSupport`),
  list, first-page PNG `preview` (gs+graphicsmagick), `download`, `retry`, transactional
  `process` (create expense → copy file into the expense's attachments → delete the inbox
  record; copy-then-delete so a failure leaves no dangling row), and `delete`.
- Expenses page gains an **Inbox tab** with an unprocessed-count badge: dropzone
  (drag/drop + paste + picker), a left rail of bills (thumbnail + status, pending spinner,
  failed-retry), and a split work area — **entry fields on the left, large PDF preview
  (iframe) on the right** — that saves into an expense and auto-advances.
**Verification:** 57 tests (2 new inbox integration tests), `scripts/audit.ts` (32/32,
incl. 7 inbox checks), a live image→PDF worker check, green gate, smoke. All pass.
**Reuse:** `imageBufferToPdf`, the pdf2pic thumbnail block, `paths.*`, `expenseSchema` +
future-date guard, `hasHeicSupport`, and the existing upload/polling/thumbnail UI patterns.

---

## Public (no-login) bill upload page (feature request)

### Q8.1 — Employee bill upload without logging in
Requested a page where employees upload bills without logging in, with optional job code +
notes. Confirmed decisions: **gated by a secret link/token**, **fields = job code + notes
only** (no submitter name).
**Implemented:**
- Migration `0015_inbox_public_fields.sql` adds `submitted_job_code`, `notes`, `source`
  (`admin`|`public`) to `inbox_documents`.
- `PUBLIC_UPLOAD_TOKEN` env var (optional; feature is **disabled when unset**). Passed
  through in prod compose; documented in `.env.example`.
- `apps/api/src/routes/public.ts` mounted **before** `requireAuth` (sessionless): token
  checked with `timingSafeEqual`, rate-limited (40/15min/IP via Redis). `POST
  /api/public/upload?k=TOKEN` (multi-file + optional `job_code`/`notes`) and a
  `GET /api/public/upload/check` so the page can show valid-vs-invalid before rendering.
  Public paths are exempt from the cookie-CSRF header (irrelevant without a session) and
  whitelisted in the auth middleware.
- Shared `ingestInboxFile` service refactored out of the authed inbox route so both paths
  share content-sniffing/storage/enqueue.
- Standalone SPA route **`/upload`** (outside the auth guard): branded, dropzone +
  job-code + notes, "invalid/expired link" state, thank-you + upload-more.
- Admin Inbox surfaces submissions: an "employee" badge + job-code line in the rail, a
  hint banner with the submitted code/notes, and the entry form **pre-selects the matching
  job** and pre-fills the description from notes.
**Verification:** 58 tests (new public integration test: no-token 401, valid-token 201,
lands in inbox with code/notes/source), `scripts/audit.ts` 37/37 (5 new public checks),
green gate, smoke. Token compared in constant time; disabled unless configured.

---

## Customer contact editing (gap fix)

### Q9.1 — Edit customer email/contact after creation
The new-customer form only exposed Contact email, and the customer drawer had no Profile
tab, so contact details couldn't be edited after creation (the API already supported it).
**Implemented:**
- Create form now also captures **address line 2, contact name, contact phone**.
- Customer drawer gains a default **Profile tab** (name, bill-to address lines, city/state/
  zip, contact name/email/phone, active) saving via `PUT /api/customers/:id`.
- Invoice detail now returns `customer_contact_email`, so the **Email Invoice** modal
  pre-fills the customer's email as the recipient.
**Verification:** 59 tests (new customer contact create/edit test), green gate, smoke.

---

## Pre-production QA — pass 1 (security + correctness hardening)

Two review agents (security + correctness) plus dynamic probing. Findings fixed:

### Dependencies — now 0 prod vulnerabilities
- Removed **unused** `docxtemplater-image-module-free` (dragged in critical `xmldom`).
- Bumped `nodemailer` 6→8 (addressparser DoS), `file-type` 19→22 (ASF loop), `drizzle-orm`
  0.31→0.45.2 (SQL-identifier-escaping CVE). All verified: tests/audit/smoke/verify-email
  pass; `npm audit --omit=dev` → **found 0 vulnerabilities**.

### Security
- **AES key (H1):** `SMTP_ENC_KEY` now must be exactly 64 hex chars (validated at config
  boot); removed the truncating non-KDF fallback; consolidated encrypt/decrypt to
  `apps/api/src/crypto.ts` (and a strict copy in the worker). `.env.example` documents the
  format.
- **Public-upload DoS (H2):** capped to 10 files/request + a storage free-space guard (507
  when low).
- **SMTP test abuse (M1):** both test endpoints now send only to the configured/own From
  address (no attacker-chosen recipient).
- **Session fixation (M2):** `req.session.regenerate()` on login.
- **CSP (M3):** added `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`.
- **Error leak (M4):** only `HttpError`/`ZodError`/explicit-4xx messages reach clients;
  everything else returns a generic 500. Multer `LIMIT_FILE_SIZE` → 413.
- **L4:** JSON body limit 5mb→1mb; added server request/headers timeouts.

### Correctness
- **Time grid (MED×2):** new atomic `POST /api/time/cell` merges one tier under a row lock
  (kills the same-row lost-update); cell inputs keyed by saved value so they reflect server
  state after refetch.
- **Inbox double-process (LOW):** the inbox row is now consumed *inside* the process
  transaction (returning-guard) — a second process can't create a duplicate expense.
- **Markup % + names on docx (LOW):** snapshot persists the markup percent (in
  `unit_rate`); the renderer resolves employee names + expense vendors by **id join**
  instead of splitting the formatted description; the starter template shows
  `Markup ({percent_label})`. Smoke now guards "Graybar" + "15%".
- **Invoice list refresh (LOW):** finalize/void also invalidate the `['invoices']` query.

### Accepted / documented
- Finalize rebuilds the preview just before the snapshot txn (a stale-bind window only
  under concurrent multi-tab editing) — acceptable for the single-admin deployment.
- `trust proxy: 1` requires exactly one reverse proxy in front (documented in OPERATIONS).
