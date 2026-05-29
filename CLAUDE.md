# Darrow Time & Invoicing — Autonomous Build Plan

> One-off web application replacing the legacy `Time_Allocation_Tracking.xlsm` workbook for Darrow Electric. Single-tenant. Self-hosted Docker deployment on x86_64 Linux. Built to be executed end-to-end by Claude Code in autonomous mode.

-----

## §0. Project Brief

### 0.1 Purpose

Replace a 36-sheet, ~7,000-row, VBA-driven Excel workbook used for:

- Tracking field-electrician time by day, job, employee, and tier (Straight / OT / Double Time)
- Logging job-related expenses (materials, equipment, freight, per diem, travel) with receipt attachments
- Generating customer invoices (Word + PDF) that combine billed time and expenses with configurable markups
- Reporting hours and expenses by job

### 0.2 Non-goals (v1)

- Multi-tenant / multi-company
- Mobile / kiosk time entry (admin enters all time)
- Customer self-service portal
- Sales tax computation (Darrow does not collect)
- OCR on receipts (attachments are embed-only)
- Email delivery is optional; download is the primary path
- Union fee tables, the **Diamond 15-day-period special rate scheme** (the customer Diamond Pet Foods stays in scope; only its bespoke 15-day affix rate logic is dropped), Lawrence-Place 5% toggle, the stock-material flat $150 line, the “Add Service Call” adder, Bill Compare, Job Check, and the parallel “Diamond” invoice block on the Proposal sheet (columns Q→) — explicitly **out of scope**. Markups are now fully general per-customer/per-invoice, which subsumes the old Lawrence-Place 5% toggle.

### 0.3 Project name & paths

- Repo / docker image: `darrow-time-invoicing`
- Database: `darrow_ti`
- Storage root: `/storage` (logo, templates, attachments, generated invoices, backups)

### 0.4 License

PolyForm Internal Use License 1.0.0 (consistent with the rest of the Vibe family — even though this is a single-client deployment, identical licensing keeps tooling uniform).

-----

## §1. Stack & Conventions

### 1.1 Runtime stack

- **Frontend**: React 18 + TypeScript + Vite + TanStack Router + TanStack Query + Tailwind CSS + shadcn/ui
- **Backend**: Node.js 20 + Express + TypeScript
- **DB**: PostgreSQL 16 with Drizzle ORM
- **Queue**: Redis 7 + BullMQ (image→PDF conversion, PDF generation, email send)
- **Auth**: express-session + connect-redis (cookie-based, server-side sessions)
- **File storage**: local filesystem under `/storage` (volume mount in production)
- **Docx templating**: `docxtemplater`
- **PDF**: `libreoffice --headless --convert-to pdf` (docx → pdf in BullMQ worker)
- **Image → PDF**: `sharp` (image normalize/orient) + `pdf-lib` (wrap into PDF)
- **Email** (optional): `nodemailer`
- **Testing**: `vitest` for unit, `playwright` for e2e

### 1.2 Repo layout (npm workspaces)

```
darrow-time-invoicing/
├── apps/
│   ├── web/                  React 18 + Vite
│   └── api/                  Express server
├── packages/
│   ├── db/                   Drizzle schema, migrations, seeds
│   ├── shared/               Shared zod schemas + TS types
│   └── workers/              BullMQ workers (image→pdf, docx render, pdf convert, email)
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml         (dev)
│   ├── docker-compose.prod.yml
│   └── entrypoint.sh
├── scripts/
│   ├── import-xlsm.ts             Historical migration
│   ├── bootstrap-admin.ts         Create first admin
│   ├── backup.sh
│   └── restore.sh
├── docs/
│   ├── PLACEHOLDERS.md            Docx template placeholder reference
│   ├── BACKUP.md
│   └── OPERATIONS.md
├── .github/workflows/docker.yml   GHCR publish
├── CLAUDE.md                      this file
├── README.md
├── LICENSE.md                     PolyForm Internal Use 1.0.0
└── package.json                   workspaces root
```

### 1.3 Code conventions

- All API routes return `{ ok: true, data }` or `{ ok: false, error: { code, message, details? } }`
- All inputs validated with zod schemas defined in `packages/shared`
- All money stored as **numeric(12,2)**; hours as **numeric(6,2)**; percents as **numeric(5,4)** (e.g., 0.1000 = 10%)
- Dates: `date` type when day-only; `timestamptz` when instant
- All timestamps in UTC at the DB; rendered in the user’s local TZ (server config = `America/Chicago` for Darrow)
- Effective-dated tables use `[effective_from, effective_to)` half-open intervals; `effective_to = NULL` means “currently active”
- No deletes for entities with downstream references — use `active = false` flag
- Migration files numbered `0001_*.sql`, `0002_*.sql`, etc.

### 1.4 Environment variables

```
DATABASE_URL=postgres://...
REDIS_URL=redis://...
SESSION_SECRET=...
STORAGE_ROOT=/storage
APP_BASE_URL=http://localhost:3000
NODE_ENV=production
LOG_LEVEL=info
LIBREOFFICE_BIN=/usr/bin/libreoffice
```

### 1.5 Glossary

- **Job**: a discrete work order with a manually-assigned code (e.g., `D26NB048`), tied to one customer
- **Rate Level**: a billing classification (Foreman, Journeyman, Apprentice Yr 1–7); each employee has exactly one active level
- **Rate Schedule**: a per-customer, date-bounded map of `level → (rate_1x, rate_1.5x, rate_2x)`
- **Tier**: ST (straight time, 1x), OT (overtime, 1.5x), DT (double time, 2x)
- **Markup**: percent uplift applied to expense categories on invoice (default per customer, overridable per invoice)
- **Invoice sequence**: per-job auto-increment `.01`, `.02`, etc. — voided invoices are skipped in counting
- **Through-date**: cutoff on an invoice draft; only time/expense entries with `work_date <= through_date` are eligible

-----

## §2. Build Plan — Phase Index

|Phase    |Title                                       |Items   |
|---------|--------------------------------------------|--------|
|1        |Project Scaffold & Infrastructure           |28      |
|2        |Authentication, Admin Bootstrap & Audit Log |26      |
|3        |Settings (Company, Logo, Template, Defaults)|30      |
|4        |Rate Levels Master List                     |16      |
|5        |Employees & Effective-Dated Cost Rates      |32      |
|6        |Customers & Markup Defaults                 |28      |
|7        |Rate Schedules                              |30      |
|8        |Jobs                                        |24      |
|9        |Time Entries — Schema + Weekly Grid UI      |38      |
|10       |Expenses & Multi-Attachment Upload          |36      |
|11       |Rate & Markup Lookup Engine                 |20      |
|12       |Invoice Draft Workflow                      |34      |
|13       |Invoice Finalize & Snapshot                 |29      |
|14       |Docx Template Renderer                      |26      |
|15       |PDF Generation Worker                       |18      |
|16       |Invoice Void Workflow                       |16      |
|17       |Email Delivery (Optional)                   |20      |
|18       |Historical XLSM Data Importer               |30      |
|19       |Reports v1 + Readiness Dashboard            |30      |
|20       |Deployment, Backup, Operations              |30      |
|**Total**|                                            |**~575**|

Each phase below has: **Goal** → **Dependencies** → **Tasks (numbered, testable)** → **Acceptance Criteria**.

-----

## Phase 1 — Project Scaffold & Infrastructure

**Goal**: Working monorepo, Postgres + Redis running in Docker, healthcheck endpoint reachable, Drizzle migrations runnable.

**Dependencies**: none.

### Tasks

1. Initialize git repo with `.gitignore` (node_modules, dist, .env, /storage)
1. Create root `package.json` with npm workspaces pointing at `apps/*` and `packages/*`
1. Add root scripts: `dev`, `build`, `test`, `lint`, `db:migrate`, `db:seed`
1. Set up TypeScript: root `tsconfig.base.json`, per-workspace `tsconfig.json` extending it
1. Set up ESLint (typescript-eslint, react) + Prettier; add lint-staged + husky pre-commit
1. Create `apps/web` with Vite + React 18 + TS + Tailwind + shadcn/ui scaffolding
1. Configure Tailwind with neutral palette; install `lucide-react` for icons
1. Create `apps/api` with Express + TS + nodemon
1. Add CORS config (allow only same-origin in prod; localhost:5173 in dev)
1. Create `packages/db` with Drizzle config pointing at Postgres
1. Create `packages/shared` for zod schemas + TS types shared between web/api
1. Create `packages/workers` skeleton with BullMQ connection
1. Write `docker/docker-compose.yml` with services: `postgres:16-alpine`, `redis:7-alpine`, named volumes for each
1. Write `docker/Dockerfile` (multi-stage: deps → build → runtime). Runtime stage installs the full media toolchain needed downstream: `libreoffice-core libreoffice-writer` (docx→pdf, Phase 15), `ghostscript` + `graphicsmagick` (pdf→png thumbnails, Phases 10/19), and `libheif1`/`libheif-dev` plus a sharp build that includes HEIC support (Phase 10 HEIC uploads). If a working HEIC pipeline proves heavy, fall back to dropping HEIC from accepted types (see Phase 10 task 9) and document the decision — do not ship an image that silently fails on HEIC.
1. Write `docker/docker-compose.prod.yml` adding the app service + a single `/storage` volume mount
1. Write `docker/entrypoint.sh`: runs migrations on boot, then starts api + workers concurrently
1. Add `.env.example` covering every var in §1.4
1. Add config loader (`apps/api/src/config.ts`) that validates env via zod at startup; crash on missing
1. Set up Winston logger writing JSON to stdout
1. Create `/api/health` returning `{ ok: true, db: 'up' | 'down', redis: 'up' | 'down', version }`
1. Wire up TanStack Router with one root route showing “Darrow Time & Invoicing” placeholder
1. Wire up TanStack Query with default `staleTime: 30s`, `retry: 1`
1. Set up Vite proxy from `/api` → `http://localhost:4000` in dev
1. Write `.github/workflows/docker.yml`: build + push to GHCR on tag `v*.*.*`
1. Write `.github/workflows/ci.yml`: install, lint, type-check, unit tests on PR
1. Add `README.md` with quick-start (`docker compose up`, `npm run dev`, default admin creds)
1. Add `LICENSE.md` (PolyForm Internal Use 1.0.0 text)
1. Confirm: `docker compose up` → `/api/health` returns `{ db: 'up', redis: 'up' }` in browser

### Acceptance

- `npm run dev` starts api + web concurrently
- `docker compose up` brings up Postgres + Redis with persistent volumes
- `/api/health` returns 200 with both deps up
- CI passes on a clean checkout
- `npm run db:migrate` runs against a freshly-created Postgres

-----

## Phase 2 — Authentication, Admin Bootstrap & Audit Log

**Goal**: Single admin user can log in via username + password; session stored in Redis; auth middleware protects all `/api/*` except `/api/health` and `/api/auth/*`.

**Dependencies**: Phase 1.

### Tasks

1. Drizzle table `users`: `id (uuid)`, `username (text unique)`, `password_hash (text)`, `role (enum: admin | owner)`, `active (bool)`, `created_at`, `last_login_at`
1. Migration `0001_users.sql`
1. Add bcrypt (`bcrypt` npm package, work factor 12)
1. Write `scripts/bootstrap-admin.ts`: prompts for username + password, creates first admin row; idempotent (errors if any admin already exists)
1. Add `pnpm bootstrap` script or document `npx tsx scripts/bootstrap-admin.ts`
1. Install `express-session` + `connect-redis` + `redis`
1. Configure session middleware: 14-day rolling cookie, `httpOnly`, `sameSite: 'lax'`, `secure` when `NODE_ENV=production`
1. POST `/api/auth/login`: body `{ username, password }`, validates bcrypt, sets `req.session.userId`, returns user (without hash)
1. POST `/api/auth/logout`: destroys session
1. GET `/api/auth/me`: returns current user or 401
1. POST `/api/auth/change-password`: requires current password, validates min length 12
1. Auth middleware `requireAuth` attached to all routes under `/api` except whitelisted
1. Auth middleware `requireRole(...roles)` for role-gated routes (admin-only for now)
1. Rate limit `/api/auth/login` to 10 attempts per IP per 15 min (use `express-rate-limit` + Redis store)
1. **Audit log foundation** (referenced by Phases 5, 6, 7, 8, 10, 12, 13, 16, 17, 19): Drizzle table `audit_log`: `id (uuid)`, `at (timestamptz default now())`, `user_id (fk users nullable — null for system/importer actions)`, `entity_type (text)`, `entity_id (text)`, `action (text — e.g. create | update | deactivate | finalize | void | email | export | import)`, `summary (text)`, `detail (jsonb nullable)`. Index on `(entity_type, entity_id)` and on `at`.
1. Write `writeAudit({ userId, entityType, entityId, action, summary, detail? })` service in `apps/api/src/audit.ts`; all later phases call this. The importer (Phase 18) passes `userId = null` with `action = 'import'`.
1. GET `/api/audit?entity_type=&entity_id=&from=&to=&page=` returns paginated entries (admin-only) for a future audit-viewer UI; the read endpoint is built now, the viewer screen is deferred.
1. Frontend: `LoginPage.tsx` with username/password form, shadcn/ui inputs
1. Frontend: `AuthProvider` context using `useQuery(['me'])`
1. Frontend: `ProtectedRoute` wrapper redirecting to `/login` if 401
1. Frontend: top-nav with username display + logout button
1. Frontend: `ChangePasswordDialog` accessible from user menu
1. Unit tests: bcrypt round-trip, login rate limit, session cookie set/cleared
1. Unit tests: `writeAudit` persists a row; `/api/audit` filters by entity
1. E2E test: bootstrap admin → log in → access protected route → logout → redirected
1. Confirm: `pnpm bootstrap` then login at `/login` works end-to-end

### Acceptance

- First-run admin can be created via script
- Login persists across page reload (cookie + Redis session)
- All `/api/*` except whitelisted return 401 without a session
- Rate limit blocks brute force after 10 attempts
- `audit_log` table exists and `writeAudit` is callable from any service

-----

## Phase 3 — Settings (Company, Logo, Template, Defaults)

**Goal**: Single-row “settings” record holds company info, logo, docx template, and default markup percentages; all editable via Settings page.

**Dependencies**: Phase 2.

### Tasks

1. Drizzle table `settings` (enforced singleton): integer PK `id` with `CHECK (id = 1)` and a default of 1, so only one row can ever exist. Columns: `company_name`, `address_line1`, `address_line2`, `city`, `state`, `zip`, `phone`, `email`, `logo_path` (nullable), `template_docx_path` (nullable), `updated_at`
1. Drizzle table `settings_markup_defaults`: `category (enum)`, `percent (numeric(5,4))`, PK on `category`
1. Drizzle enum `expense_category`: `materials`, `equipment_rent`, `truck_rental`, `per_diem`, `travel`, `freight`, `stock_material`
1. Migration with seed row for `settings` (blank fields) + one row per category in `settings_markup_defaults` (defaults: materials=0.15, equipment_rent=0.10, others=0.00)
1. GET `/api/settings` returns the singleton with markups
1. PUT `/api/settings` validates body via zod, updates record
1. PUT `/api/settings/markups` accepts `{ category, percent }[]` and upserts all
1. POST `/api/settings/logo` (multer): max 2MB, accepts `image/png` or `image/jpeg`, saves to `/storage/branding/logo.{ext}`, updates `logo_path`
1. DELETE `/api/settings/logo`: removes file + clears column
1. POST `/api/settings/template`: max 5MB, accepts `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, saves to `/storage/branding/template.docx`, updates `template_docx_path`
1. DELETE `/api/settings/template`
1. GET `/api/settings/template/download`: streams current template
1. GET `/api/settings/placeholders` returns the static placeholder reference (read from `docs/PLACEHOLDERS.md`)
1. Frontend: `SettingsPage` with three tabs — Company, Branding, Markups
1. Company tab: form for all address/contact fields with save button
1. Branding tab: logo dropzone with preview; template dropzone with “current template” download link + “view placeholders” button
1. Markups tab: table of categories × percent (display as %, store as decimal), save button
1. Image preview after upload: render `<img src="/api/settings/logo">` cache-busted
1. Add `/api/settings/logo` static-serve route reading from `logo_path`
1. Write `docs/PLACEHOLDERS.md` enumerating supported docx placeholders (see Phase 14 for the list)
1. Wire placeholder reference into a `<Drawer>` on the Branding tab
1. Validation: phone normalized to `(###) ###-####`, email lowercased, zip 5-digit or 5+4
1. Unit tests: settings upsert, markup upsert, logo upload happy path + oversize rejection
1. E2E: upload logo → reload → logo persists; upload template → download returns same bytes
1. Frontend toast on save success/failure
1. Frontend: dirty-state guard (warn on navigate away with unsaved changes)
1. Loading skeletons while settings load
1. Document seed defaults in `README.md`
1. Add favicon and page title “Darrow Electric — Time & Invoicing”
1. Confirm: a fresh deploy with default seeded markups can render an invoice (sets the floor for later phases)

### Acceptance

- Settings page round-trips all fields without data loss
- Logo upload limited to 2MB png/jpg, served back over `/api/settings/logo`
- Template upload limited to 5MB docx, downloadable round-trip
- Markup defaults visible and editable; percent inputs accept whole-number entry but store decimals

-----

## Phase 4 — Rate Levels Master List

**Goal**: Admin can manage the list of rate levels used throughout the system (Foreman, Journeyman, Apprentice Yr 1–7).

**Dependencies**: Phase 3.

### Tasks

1. Drizzle table `rate_levels`: `id (uuid)`, `name (text unique)`, `sort_order (int)`, `active (bool)`, `created_at`
1. Seed: Foreman (0), Journeyman (1), Apprentice Yr 1 (2) … Apprentice Yr 7 (8)
1. GET `/api/rate-levels?includeInactive=bool` returns sorted list
1. POST `/api/rate-levels` creates new (validates unique name)
1. PUT `/api/rate-levels/:id` updates name / sort_order / active
1. DELETE `/api/rate-levels/:id` blocked if any employee references it; return 409 with detail
1. PATCH `/api/rate-levels/reorder` accepts `[{ id, sort_order }]` array, applies in a transaction
1. Frontend: `RateLevelsPage` table with drag-handle reorder (dnd-kit)
1. Add / edit modal with name + active toggle
1. Inactive levels rendered with strikethrough; cannot be assigned to new employees
1. Show “in use by N employees” badge on each row
1. Delete confirms via modal; if blocked, surfaces the conflict count
1. Unit tests: reorder persists, delete-when-referenced blocked
1. E2E: add level → assign to employee (manual setup) → attempt delete → error → deactivate → succeeds
1. Empty state when no levels exist (shouldn’t happen post-seed but defensive)
1. Confirm: seeded list of 9 levels visible on first load

### Acceptance

- All CRUD operations work; sort persists; deletion guarded by FK check

-----

## Phase 5 — Employees & Effective-Dated Cost Rates

**Goal**: Manage field employees, each with one active rate level and a history of cost rates (ST/OT/DT) bounded by effective dates.

**Dependencies**: Phase 4.

### Tasks

1. Drizzle table `employees`: `id (uuid)`, `name (text)`, `level_id (fk rate_levels)`, `active (bool)`, `hire_date (date nullable)`, `notes (text nullable)`, `created_at`
1. Drizzle table `employee_cost_rates`: `id`, `employee_id (fk)`, `effective_from (date)`, `effective_to (date nullable)`, `cost_st (numeric)`, `cost_ot (numeric)`, `cost_dt (numeric)`, `created_at`
1. Postgres exclusion constraint preventing overlapping `[effective_from, effective_to)` ranges per employee (`EXCLUDE USING gist`)
1. Migration includes `CREATE EXTENSION btree_gist`
1. GET `/api/employees?includeInactive=bool` with current rate joined
1. GET `/api/employees/:id` with full rate history
1. POST `/api/employees` validates name unique, level_id exists and active
1. PUT `/api/employees/:id` (name, level, active, hire_date, notes)
1. POST `/api/employees/:id/cost-rates` accepts `{ effective_from, cost_st, cost_ot, cost_dt }`; auto-closes the prior open rate by setting `effective_to = effective_from`
1. PUT `/api/employee-cost-rates/:id` for typo fixes (validates no overlap)
1. DELETE `/api/employee-cost-rates/:id` only allowed for the most-recent row (no time entries fall in its range)
1. Service: `getCostRateAt(employee_id, date)` returns the rate row covering that date (or null)
1. Frontend: `EmployeesPage` table — name, level, current ST/OT/DT, active toggle
1. Filter bar: search by name, filter by level, show/hide inactive
1. `EmployeeDrawer` with tabs: Profile, Cost Rate History
1. Cost Rate History tab: timeline-style list showing each rate window; “New Rate” button opens a modal
1. New Rate modal: date picker + 3 currency inputs; preview shows “Closes current rate as of <date - 1 day>”
1. Edit existing rate window inline (only metadata; effective_from editable with overlap check)
1. Active toggle: cannot deactivate if employee has unbilled time entries (offer “deactivate after current invoice cycle” hint)
1. Bulk import button (stub) — defers to Phase 18 importer
1. Unit tests for `getCostRateAt`: date inside window, date in gap, date in future, no rates exist
1. Unit tests for exclusion constraint: overlapping insert rejected
1. Unit tests: new rate auto-closes previous
1. E2E: create employee → set initial cost rate → add second rate → first auto-closes
1. Validation: cost rates must be non-negative; OT >= ST, DT >= OT (warning only, not blocking)
1. Render current rate badge color: green (set), gray (none) on employee list
1. Add CSV export of employees + current rates
1. Add audit log entries for create / update / deactivate
1. Loading skeleton on list
1. Empty state with “Add first employee” CTA
1. Confirm: rate history reads correctly across boundaries (date = effective_from inclusive, = effective_to exclusive)
1. Document `EXCLUDE USING gist` choice in `docs/OPERATIONS.md`

### Acceptance

- Cost rates cannot overlap; constraint enforced at DB layer
- `getCostRateAt(emp, date)` returns the correct row for any date
- Adding a new rate cleanly closes the prior one
- Cannot deactivate an employee with unbilled time

-----

## Phase 6 — Customers & Markup Defaults

**Goal**: Customer master with bill-to address, default markup percentages per expense category (override settings defaults), and a pointer to a default rate schedule (built in Phase 7).

**Dependencies**: Phase 3.

### Tasks

1. Drizzle table `customers`: `id (uuid)`, `name (text unique)`, `bill_to_address1`, `bill_to_address2`, `bill_to_city`, `bill_to_state`, `bill_to_zip`, `contact_name`, `contact_email`, `contact_phone`, `active`, `notes`, `created_at`
1. Drizzle table `customer_markup_defaults`: `customer_id`, `category (enum)`, `percent (numeric)`, PK on (customer_id, category)
1. GET `/api/customers?includeInactive=bool` (with markup map joined as object)
1. GET `/api/customers/:id`
1. POST `/api/customers`: name unique check
1. PUT `/api/customers/:id`
1. PUT `/api/customers/:id/markups`: accepts full category map, upserts each
1. DELETE `/api/customers/:id`: blocked if any jobs reference it; offer deactivate instead
1. Service: `getCustomerMarkup(customer_id, category)` → percent (customer override → settings default → 0)
1. Frontend: `CustomersPage` table — name, city, active, # of jobs
1. Search by name, filter by active
1. `CustomerDrawer` tabs: Profile, Markups, Jobs (list with link)
1. Profile tab: contact + bill-to address form
1. Markups tab: table of categories × percent with “inherit from settings” indicator when null/unset
1. Markups input: each row has a “use default” link that clears the override
1. Rate schedule assignment field added in Phase 7 (defer the field but reserve in schema as nullable `default_rate_schedule_id`)
1. Jobs tab shows count + link to jobs filtered by this customer (lights up in Phase 8)
1. Unit tests: `getCustomerMarkup` precedence; upsert markup map
1. E2E: create customer → set markup override → reload → persists
1. CSV export of customer list
1. Validation: at minimum one address line + city + state + zip required
1. Show “inherits 15% (settings default)” as hint text below empty markup field
1. Audit log on create/update/deactivate
1. Loading skeleton + empty state
1. Migration seed: import Companies sheet → 9 customer rows with names from xlsm (Jasper Products, Bagcraft, Nutra Blend, Sugar Creek, Diamond Pet Foods, Graham Packaging, Modine, Eagle Picher, Darlington); seed empty addresses for admin to fill in
1. Migration seed sets `name` exactly as in xlsm to preserve historical references
1. Confirm: customer list loads with 9 seeded customers + default markup inheritance
1. Document the precedence chain (invoice override → customer default → settings default → 0) in `docs/OPERATIONS.md`

### Acceptance

- Customer CRUD works
- Markup precedence resolved correctly in service layer
- Cannot delete customer with jobs

-----

## Phase 7 — Rate Schedules

**Goal**: Each customer can have multiple date-bounded rate schedules; each schedule maps every active rate level to (1x, 1.5x, 2x) bill rates.

**Dependencies**: Phase 4, Phase 6.

### Tasks

1. Drizzle table `rate_schedules`: `id`, `customer_id`, `name`, `effective_from (date)`, `effective_to (date nullable)`, `notes`, `created_at`
1. Drizzle table `rate_schedule_lines`: `id`, `schedule_id`, `level_id`, `rate_1x`, `rate_15x`, `rate_2x`, PK or unique on (schedule_id, level_id)
1. Postgres exclusion constraint preventing overlapping `[effective_from, effective_to)` per customer
1. GET `/api/customers/:id/rate-schedules` returns list with line counts
1. GET `/api/rate-schedules/:id` returns schedule + lines (joined with level name/sort_order)
1. POST `/api/customers/:id/rate-schedules` creates schedule; optionally clones lines from prior schedule
1. PUT `/api/rate-schedules/:id`: name / effective_from / effective_to / notes (re-validates overlap)
1. POST `/api/rate-schedules/:id/lines/bulk`: upserts `[{ level_id, rate_1x, rate_15x, rate_2x }]`
1. DELETE `/api/rate-schedules/:id`: blocked if any invoice line snapshots reference it (Phase 13); if no invoices exist yet, allowed
1. Service: `getRateAt(customer_id, level_id, work_date)` → `{ rate_1x, rate_15x, rate_2x } | null`
1. Service `getRateAt` algorithm: find schedule for customer where `work_date ∈ [from, coalesce(to, infinity))`; then look up level line; return null with reason code if either missing
1. Add `default_rate_schedule_id` column to `customers` (nullable FK to `rate_schedules`) — backfill from latest active schedule per customer once schedules exist
1. Frontend: `RateSchedulesTab` inside the customer drawer
1. List of schedules sorted by effective_from desc; “Active” badge on current
1. “New Schedule” button → modal with `effective_from`, optional `effective_to`, and “Clone lines from <latest>” checkbox
1. `RateScheduleEditor` page (full route): top header with date range + name, body is matrix `(level row × tier column)` with money inputs
1. Auto-save (debounced) per cell with optimistic UI; failed save shows red border + retry
1. Warning banner if any active level missing a line (yellow, not blocking finalize)
1. Diff preview: when editing dates, show how many time entries fall in the new range
1. Unit tests: `getRateAt` for date in window, out-of-window, no schedule, level not in schedule
1. Unit tests: clone-from-previous copies all lines
1. Unit tests: exclusion constraint rejects overlapping schedule
1. E2E: create schedule → fill matrix → assign customer default → verify invoice in Phase 12 resolves rate
1. Validation: `effective_to >= effective_from` (can be NULL for open-ended)
1. Validation: rates non-negative; warning if `rate_15x < rate_1x` or `rate_2x < rate_15x`
1. Add “compare with previous schedule” view showing delta per cell
1. Audit log on schedule create / edit / line bulk-update
1. Loading skeletons; empty state guides user to create first schedule
1. Allow setting `default_rate_schedule_id` to a schedule that doesn’t cover today (warn but allow — for forward-dated schedules)
1. Confirm: editing `effective_to` of one schedule to overlap another is rejected by DB

### Acceptance

- Multiple schedules per customer, non-overlapping
- `getRateAt` returns correct rates for any date / customer / level
- UI matrix saves smoothly with debounced auto-save

-----

## Phase 8 — Jobs

**Goal**: Manage jobs with manually-entered codes, customer association, description, PO#, T/M-or-Quote label, and optional job-site address.

**Dependencies**: Phase 6.

### Tasks

1. Drizzle table `jobs`: `id`, `code (text unique citext)`, `customer_id`, `description`, `po_number (nullable)`, `billing_type (enum: tm | quote)`, `site_address1`, `site_address2`, `site_city`, `site_state`, `site_zip`, `active`, `notes`, `created_at`
1. Use `citext` for code so case-insensitive uniqueness (`CREATE EXTENSION citext`)
1. GET `/api/jobs?customer_id=&active=&billing_type=&search=&page=&pageSize=`
1. GET `/api/jobs/:id`
1. POST `/api/jobs`: code unique check (case-insensitive); customer must be active
1. PUT `/api/jobs/:id`
1. DELETE `/api/jobs/:id`: blocked if any time entries or expenses reference it; offer deactivate
1. Frontend: `JobsPage` paginated table — code, customer, description, billing_type badge, # of invoices, active
1. Filter bar: customer multi-select, billing_type, active, full-text search across code + description
1. `JobDrawer` tabs: Profile, Time Entries (count + recent), Expenses (count + recent), Invoices (list)
1. Profile tab: code, customer dropdown, description, PO, billing_type radio, site address fields
1. Code field on create: free-text with format hint “(e.g., D26NB048)”; no auto-generation
1. Validation: code required; description required; customer required
1. Show “no rate schedule for customer covering today” warning if applicable
1. Quick-create from time grid (Phase 9) opens a slim modal
1. Audit log entries
1. Unit tests: code uniqueness case-insensitive (“D26NB048” === “d26nb048”)
1. Unit tests: deletion blocked by FK
1. E2E: create job → view in list → edit → deactivate
1. CSV export of job list (with totals from Phase 13 once available)
1. Migration seed: import Job Codes sheet (≈1,085 rows) via the Phase 18 `parseJobCode` helper (longest-match customer code; unmapped codes → placeholder customer + warning); seed default `billing_type=tm` unless the sheet’s `T/M Quote` column says `Quote`
1. Document the code prefix convention in `docs/OPERATIONS.md` (purely historical; new codes are free-form)
1. Loading skeleton + empty state
1. Confirm: seeded jobs visible; can create a new job with a never-before-used code

### Acceptance

- 1,085 historical jobs seeded
- Code uniqueness enforced case-insensitively
- All CRUD works; deletion guarded

-----

## Phase 9 — Time Entries — Schema + Weekly Grid UI

**Goal**: Normalized one-row-per-(employee, job, day) storage with manual ST/OT/DT, presented to the user as a familiar weekly grid (Mon–Sun, 21 cells per row).

**Dependencies**: Phase 5, Phase 8.

### Tasks

1. Drizzle table `time_entries`: `id`, `employee_id`, `job_id`, `work_date (date)`, `st_hours (numeric default 0)`, `ot_hours (numeric default 0)`, `dt_hours (numeric default 0)`, `invoice_id (nullable fk invoices — added in Phase 12 via late-binding migration)`, `created_at`, `updated_at`
1. Unique constraint on (employee_id, job_id, work_date)
1. Check constraint: all three hour columns >= 0; at least one > 0 (no all-zero rows)
1. Index on (job_id, work_date) for invoice draft queries
1. Index on (employee_id, work_date) for employee reports
1. GET `/api/time/week?week_start=YYYY-MM-DD` returns nested structure: `[{ employee_id, employee_name, jobs: [{ job_id, job_code, days: [{ date, st, ot, dt }] }] }]`
1. POST `/api/time/entries`: upsert by (employee_id, job_id, work_date) with new hour values; if all zero, delete the row
1. POST `/api/time/entries/bulk`: accepts an array of (employee_id, job_id, work_date, st, ot, dt) — transactional upsert/delete
1. DELETE `/api/time/entries/:id` only allowed when invoice_id is null
1. POST `/api/time/copy-week?from=&to=`: copies all unbilled rows from `from` week to `to` week
1. Service: validate every entry’s employee + job are active at the work_date (warn, don’t block). Time tracking is intentionally decoupled from billing readiness — entries are allowed even when the job’s customer has no covering rate schedule; the missing-rate problem surfaces only at invoice draft/finalize and on the readiness dashboard (Phase 19).
1. Frontend: `TimeGridPage` route `/time/:weekStart`
1. Week navigator: prev / next / today buttons; calendar picker; URL reflects week
1. Week always starts Monday (use date-fns `startOfWeek({ weekStartsOn: 1 })`)
1. Grid layout: header row = day labels + tier labels (ST OT DT × 7 = 21 cells); body rows = employees, with one sub-row per job they have hours on
1. “Add job for <employee>” inline action → searchable combobox of active jobs
1. “Add employee” inline action at bottom → searchable combobox
1. Each cell is a `<NumberInput>` that auto-saves on blur (debounced 500ms)
1. Cells with `invoice_id != null` rendered locked (gray bg, read-only) with tooltip “Billed on Invoice {number}”
1. Row totals (employee ST, OT, DT, total) computed client-side and rendered to the right
1. Day totals (column footers) computed client-side
1. Visual indicator for current day column (subtle border)
1. Keyboard nav: Tab moves cell-right, Enter moves cell-down
1. “Copy from last week” button (calls bulk endpoint after preview)
1. Filter chips: filter visible employees by level / search
1. Empty state when no entries for the week
1. Loading skeleton during initial fetch
1. Optimistic updates with rollback on save failure (toast)
1. Conflict resolution: if two tabs edit the same cell, last-write-wins with a warning toast
1. Save indicator in top-right (“All changes saved” / “Saving…” / “Save failed — retry”)
1. Print view / CSV export of the week
1. Unit tests: upsert deletes row when all zero
1. Unit tests: locked entries reject updates
1. Unit tests: bulk endpoint transactional (one bad row rolls back all)
1. E2E: open week → enter hours → reload → values persist; finalize an invoice (Phase 13) → cells lock
1. Validation: hours capped at 24 per day per employee per tier (sanity)
1. A11y: cells have aria-label like “Brett Howard, D26NB048, Monday ST”
1. Confirm: 5,000+ historical entries render the current week smoothly (sub-200ms)

### Acceptance

- Grid renders Mon–Sun with 21 cells per (employee × job) row
- Edits auto-save; locked cells when invoiced
- Week navigation updates URL and reloads cleanly

-----

## Phase 10 — Expenses & Multi-Attachment Upload

**Goal**: Log job-related expenses with multiple PDF/image attachments. Images are auto-converted to PDF in a background worker.

**Dependencies**: Phase 8.

### Tasks

1. Drizzle table `expenses`: `id`, `work_date (date)`, `job_id`, `vendor (text)`, `reference (text nullable)` — vendor invoice / reference number (e.g. `S010629890.001` from the legacy AW feed), `amount (numeric)`, `category (enum)`, `description (text nullable)`, `invoice_id (nullable)`, `imported_from_xlsm (bool default false)`, `created_at`, `updated_at`
1. Drizzle table `expense_attachments`: `id`, `expense_id`, `original_filename`, `stored_path`, `content_type`, `file_size_bytes`, `status (enum: pending | ready | failed)`, `created_at`
1. Storage layout: `/storage/expenses/{expense_id}/{attachment_id}.pdf`
1. GET `/api/expenses?job_id=&from=&to=&invoice_status=&page=`
1. GET `/api/expenses/:id` includes attachments array
1. POST `/api/expenses` validates fields
1. PUT `/api/expenses/:id` blocked when `invoice_id != null`
1. DELETE `/api/expenses/:id` cascades to attachments + files; blocked when invoiced
1. POST `/api/expenses/:id/attachments` (multer): max 25MB per file, accepts pdf, png, jpg, jpeg, webp, and heic **only if the runtime sharp build reports HEIC support** (probe `sharp.format.heif` at boot). If HEIC support is absent, reject `.heic` with a clear message telling the user to share as JPG/PDF, and document the limitation in `docs/OPERATIONS.md`. Validate by content-type sniffing (`file-type`), not extension.
1. For PDFs: save directly to final path with `status=ready`
1. For images: save raw to `/storage/expenses/{id}/_pending/{uuid}.{ext}` with `status=pending`, enqueue BullMQ job
1. BullMQ worker `image-to-pdf`: load image via sharp (auto-rotate based on EXIF; HEIC decoded via libheif when available), embed into single-page A4 PDF via pdf-lib at native DPI (preserve aspect, max 80% of page), save final, delete pending source, set `status=ready`
1. On worker failure: increment retry counter (max 3), then set `status=failed`, surface in UI
1. DELETE `/api/expense-attachments/:id` removes row + file (blocked if parent expense invoiced)
1. GET `/api/expense-attachments/:id/download` streams the pdf
1. GET `/api/expense-attachments/:id/preview` returns a first-page PNG thumbnail generated with Ghostscript + GraphicsMagick (via `pdf2pic`), cached to `/storage/expenses/{id}/{attachment_id}.thumb.png`; both binaries are installed in the Docker image (Phase 1 task 14). Generate lazily on first request.
1. Frontend: `ExpensesPage` paginated table — date, job, vendor, amount, category, # of attachments, invoice status badge
1. Filter bar: job, category, date range, invoice status (unbilled / billed)
1. `ExpenseDrawer` shows form + attachments list with thumbnails
1. Attachments list: thumbnail, filename, size, status, download, delete buttons
1. Dropzone supports multi-file drag & drop + paste-from-clipboard
1. Upload progress bars per file
1. Status polling: `pending` rows refetch every 2s until `ready` or `failed`
1. Failed status shows “Retry” button (re-enqueues job)
1. Add expense from grid: “Add expense” button on Job detail page
1. Frontend: `ExpenseForm` shared component
1. Unit tests: image-to-pdf worker (use a fixture jpg; assert output is a valid 1-page pdf with image embedded)
1. Unit tests: PDF upload skips worker (status=ready immediately)
1. Unit tests: locked expense rejects updates
1. E2E: create expense → upload 2 images + 1 pdf → wait for ready → preview thumbnails → download
1. Validation: amount > 0; vendor required; date not in future > 30 days
1. CSV export of expenses (without attachments)
1. Bulk delete unbilled expenses (admin convenience)
1. Audit log on create / update / delete
1. Loading skeleton + empty state
1. Confirm: a 10MB phone photo uploaded becomes a single-page PDF within 5s

### Acceptance

- Multi-file uploads work; images convert to PDF in background
- Failed conversions are visible with retry
- Locked (invoiced) expenses cannot be modified

-----

## Phase 11 — Rate & Markup Lookup Engine

**Goal**: Pure-service layer used by invoice draft + finalize to resolve the right rate and markup for every line, with full audit-traceability.

**Dependencies**: Phase 5, Phase 7, Phase 10.

### Tasks

1. Service `getRateAt(customer_id, level_id, work_date)`: returns `{ rate_1x, rate_15x, rate_2x, schedule_id, schedule_name }` or `{ error: 'no_schedule' | 'no_level_line', detail }`
1. Service `getCostRateAt(employee_id, work_date)`: returns `{ cost_st, cost_ot, cost_dt, rate_id }` or `{ error: 'no_cost_rate' }`
1. Service `getMarkupPercent(customer_id, category, invoice_override_pct?)`: returns `{ percent, source: 'invoice' | 'customer' | 'settings' | 'zero' }`
1. Service `priceTimeEntry(entry, customer_id)`: returns `{ st: { hours, rate, amount }, ot, dt, total }` using getRateAt with employee.level_id and entry.work_date
1. Service `priceExpenseEntry(expense, customer_id, invoice_overrides)`: returns `{ amount, markup_percent, markup_amount, total }`
1. Service `computeInvoiceTotals(time_entries[], expenses[], customer_id, invoice_overrides)`: aggregates everything into category subtotals + grand total + cost subtotals (for margin)
1. All services pure (no DB writes) and unit-testable in isolation
1. Errors are returned, not thrown — caller decides whether to block finalize
1. Unit test: rate lookup on date inside / outside / boundary of schedule window
1. Unit test: cost rate lookup similar
1. Unit test: markup precedence (invoice → customer → settings → zero) with each combination
1. Unit test: priceTimeEntry across all three tiers
1. Unit test: priceExpenseEntry with markup on / off
1. Unit test: computeInvoiceTotals with empty arrays returns zeros
1. Unit test: computeInvoiceTotals matches a known-good fixture (build a small scenario manually)
1. Integration test: seed customer + schedule + employee + cost rate + time entry + expense → end-to-end pricing
1. Document each function signature in `packages/shared/src/pricing.ts`
1. Add JSDoc with example usage
1. Surface lookup errors in the invoice draft preview (Phase 12) with actionable links (“Add rate schedule for <customer>”)
1. Confirm: 100% branch coverage on pricing module

### Acceptance

- Pricing services are pure, fully unit-tested
- Errors propagate to the UI with actionable context

-----

## Phase 12 — Invoice Draft Workflow

**Goal**: Admin creates an invoice draft scoped to a job + through-date; system pre-selects all eligible unbilled time/expense entries; admin can include/exclude individual rows and override markups before finalizing.

**Dependencies**: Phase 9, Phase 10, Phase 11.

### Tasks

1. Drizzle table `invoices`: `id (uuid)`, `job_id`, `sequence_number (int — assigned at finalize for NEW invoices; nullable)`, `billed_reference (text)` — the canonical invoice number string. For new invoices this is computed as `{job.code}.{sequence_number zero-padded to >=2 digits}`; for historical imports (Phase 18) the **original** reference string (e.g. `D24B001.01`, `D25D013.70`) is stored verbatim and `sequence_number` is parsed from it when numeric, else left null. `status (enum: draft | finalized | void)`, `through_date (date)`, `notes (text)`, `created_at`, `created_by_user_id`, `finalized_at (nullable)`, `voided_at (nullable)`, `generated_docx_path (nullable)`, `generated_pdf_path (nullable)`, `imported_from_xlsm (bool default false)`
1. **Snapshot total columns on `invoices`** (the canonical totals the docx renderer reads in Phase 14, written at finalize): `total_labor`, `total_labor_cost`, `total_materials`, `total_equipment_rent`, `total_truck_rental`, `total_per_diem`, `total_travel`, `total_freight`, `total_stock_material`, `total_markup`, `total_expense_cost`, `grand_total` — all `numeric(12,2)`, nullable until finalize. These are persisted from `computeInvoiceTotals` so renderer/reports never recompute against mutable rate data.
1. Drizzle table `invoice_markup_overrides`: `invoice_id`, `category`, `percent`, PK (invoice_id, category) — only present rows override defaults
1. Drizzle table `invoice_line_items` (created at finalize, Phase 13): defer schema definition to Phase 13 but stub the table
1. Late-binding migration adding `invoice_id` FK to `time_entries` and `expenses` (deferred from Phase 9/10)
1. POST `/api/invoices/draft` `{ job_id, through_date }` creates draft + auto-binds all unbilled entries with `work_date <= through_date` by setting their `invoice_id` to this draft
1. GET `/api/invoices/:id` returns invoice + bound time entries + bound expenses + markup overrides + computed preview totals (via Phase 11 services)
1. PUT `/api/invoices/:id` updates through_date / notes
1. POST `/api/invoices/:id/entries/include` `{ time_entry_ids: [], expense_ids: [] }` binds those entries to this draft
1. POST `/api/invoices/:id/entries/exclude` `{ time_entry_ids: [], expense_ids: [] }` unbinds (sets invoice_id back to null)
1. PUT `/api/invoices/:id/markup-overrides` upserts the override map
1. DELETE `/api/invoices/:id` only allowed when status=draft; unbinds all entries first
1. Constraint: only one draft per job at a time (DB partial unique index `WHERE status = 'draft'`)
1. Service: validate draft is finalize-ready — every bound time entry resolves a rate (`getRateAt` returns no error) and a cost rate (`getCostRateAt` no error), and **no bound expense has an attachment still in `pending`/`failed` status** (attachments are optional, but any attachment that exists must be fully converted before finalize so the snapshot is reproducible). Return a structured list of blockers.
1. Frontend: `InvoicesPage` table — invoice #, job code, customer, status, total, created, finalized
1. Filters: status, customer, job, date range
1. “New Draft” button → modal asks job + through_date; opens `InvoiceDraftPage` after creation
1. `InvoiceDraftPage` layout: left column = entry pickers (Time + Expense tabs), right column = live preview
1. Time entries picker: grouped by date, checkbox per row, “select all” / “deselect all”, shows hours and computed bill amount per row
1. Expense entries picker: grouped by category, checkbox per row, attachment count, computed total with markup
1. Markup overrides: collapsible panel showing each category with current effective percent + source badge + override input
1. Preview pane: shows what the invoice will look like with current selections + markups (category subtotals + grand total)
1. Warning banners surface from Phase 11 errors (missing rates, missing cost rates, pending/failed attachments)
1. Save-as-you-go: include/exclude calls happen immediately; preview refreshes via `useQuery` invalidation
1. “Save draft and exit” returns to invoices list
1. “Finalize” button (covered in Phase 13) disabled when validation errors exist
1. Audit log on draft create / include / exclude / markup change
1. Validation: through_date not in future
1. Unit tests: auto-bind on create
1. Unit tests: exclude unbinds entries
1. Unit tests: draft uniqueness per job
1. Unit tests: finalize-ready validation flags a pending attachment and a missing rate
1. E2E: create draft for a job → toggle entries → adjust markup → preview reflects → save and reopen
1. Confirm: drafts don’t appear in finalized-only reports

### Acceptance

- One draft per job enforced
- Entry binding via include/exclude is reversible until finalize
- Preview matches the eventual finalized totals to the cent

-----

## Phase 13 — Invoice Finalize & Snapshot

**Goal**: Lock a draft, assign the next per-job sequence number, snapshot all line items with resolved rates and markups, and trigger background docx + pdf generation.

**Dependencies**: Phase 12.

### Tasks

1. Drizzle table `invoice_line_items`: `id`, `invoice_id`, `line_order (int)`, `line_type (enum: labor | labor_subtotal | expense | expense_subtotal | expense_markup | grand_total)`, `category (nullable enum)`, `employee_id (nullable)`, `expense_id (nullable)`, `description (text)`, `tier (nullable enum: st | ot | dt)`, `quantity (numeric)`, `unit_rate (numeric)`, `amount (numeric)`, `cost_amount (nullable numeric)`. Note `expense` lines carry their pre-markup `amount` **and** the same value in `cost_amount` (an expense’s cost to the firm = its raw amount), so margin reporting needs no recomputation.
1. POST `/api/invoices/:id/finalize`: validates → snapshots line items → **persists snapshot totals onto the `invoices` row** (all `total_*` + `grand_total` columns from Phase 12 task 2, computed once via `computeInvoiceTotals`) → assigns sequence + sets `billed_reference` → updates status → enqueues docx + pdf jobs. All in one transaction.
1. Sequence assignment: `SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM invoices WHERE job_id = ? AND status != 'void' FOR UPDATE` inside the transaction; then `billed_reference = job.code || '.' || lpad(seq::text, 2, '0')`
1. Snapshot algorithm (every total/subtotal stored as a real row — nothing computed at render time, for a complete immutable snapshot):
- For each bound time entry: emit one `labor` line per non-zero tier (`st`, `ot`, `dt`) with employee name, tier label, hours as quantity, resolved bill rate, computed amount, and `cost_amount` from the resolved cost rate × hours
- Emit one `labor_subtotal` line
- For each bound expense: emit one `expense` line (per entry, for traceability) with `{category_label} – {vendor} – {description}`, `amount` = raw expense amount, `cost_amount` = same raw amount
- For each category present: emit one `expense_subtotal` line
- For each category with a non-zero effective markup: emit one `expense_markup` line with the computed markup amount (`cost_amount` = 0, markup is pure margin)
- Emit one `grand_total` line
1. Skip emitting `labor`/`expense` lines whose amount is zero, per the “only show lines with hours” rule (round 4 #4); still emit subtotals/grand total even when a category is zero only if a nonzero sibling exists
1. Mark `finalized_at = now()`
1. Enqueue `render-docx` BullMQ job
1. After docx renders, enqueue `docx-to-pdf` job
1. PUT `/api/invoices/:id/markup-overrides` blocked after finalize
1. POST `/api/invoices/:id/entries/include` and `/exclude` blocked after finalize
1. PUT `/api/invoices/:id` blocked after finalize except for `notes`
1. GET `/api/invoices/:id` after finalize returns line items from snapshot, not recomputed
1. Display invoice number from the stored `billed_reference` column (e.g., `D26NB048.01`) — never recompute it for display
1. Frontend: “Finalize” button on draft page → confirmation modal showing summary
1. After finalize, redirect to read-only `InvoiceDetailPage` showing snapshot + download buttons + generation status
1. `InvoiceDetailPage` polls every 3s while docx or pdf status is `pending`
1. Show “Docx ready” / “PDF generating…” status indicators
1. Failed generation: show error + retry button (re-enqueues job)
1. Validation block: surfaces every reason finalize is blocked, with deep links to fix
1. Audit log: finalize event includes user_id + snapshot summary
1. Unit tests: sequence increment under concurrent finalize (use SELECT FOR UPDATE — simulate two transactions)
1. Unit tests: snapshot omits zero-hour lines
1. Unit tests: void invoice doesn’t consume a sequence number
1. Unit tests: snapshot matches preview totals to the cent
1. Unit tests: persisted `invoices.total_*` + `grand_total` equal the sum of the snapshot line items
1. E2E: draft → finalize → invoice number assigned → read-only view → docx + pdf become downloadable
1. E2E: concurrent finalize on two drafts for different jobs both succeed
1. Document the snapshot rationale (immutability for audit) in `docs/OPERATIONS.md`
1. Confirm: snapshot matches preview exactly; rate-schedule changes after finalize don’t affect historical invoice; header totals survive an in-place rate edit

### Acceptance

- Finalize is atomic and assigns the next per-job sequence; `billed_reference` set
- Line snapshot **and** header totals are immutable; future rate changes don’t disturb history
- Docx + PDF generation kicks off and surfaces status

-----

## Phase 14 — Docx Template Renderer

**Goal**: Render a docx invoice using the customer-uploaded template with placeholder substitution, including loops over labor and expense lines.

**Dependencies**: Phase 3 (template upload), Phase 13 (snapshot).

### Tasks

1. Install `docxtemplater` + `pizzip` + `docxtemplater-image-module-free`
1. Worker `render-docx` consumes `{ invoice_id }`
1. Load template from `settings.template_docx_path`; abort with clear error if missing
1. Build the placeholder data object (all numeric values read from the **persisted snapshot** — `invoices.total_*`/`grand_total` and `invoice_line_items` — never recomputed from rate tables):
- `company.*` from settings (name, address, phone, email)
- `logo` (when image module configured) — base64 of the logo file
- `customer.*` from invoice’s job’s customer
- `job.*` (code, description, po_number, billing_type, site_address)
- `invoice.*` (number = `invoices.billed_reference`, date = finalized_at, through_date, notes)
- `totals.*` (labor, materials, equipment_rent, truck_rental, per_diem, travel, freight, stock_material, markup, grand_total — read from `invoices.total_*` columns, each pre-formatted as `$#,##0.00`)
- `labor_lines` array from `invoice_line_items WHERE line_type='labor'`: `[{ employee_name, tier_label, hours, rate, amount }]`
- `expense_lines` array: grouped or flat — both supported via separate arrays `expense_lines_flat` and `expense_lines_by_category` (object keyed by category), sourced from `expense` line items
- `markup_lines` array from `expense_markup` line items (only categories with non-zero markup)
1. Use `docxtemplater` angular-parser for inline expressions; document syntax in placeholders doc
1. Render output to `/storage/invoices/{invoice_id}.docx`
1. Update `invoices.generated_docx_path` + status flag
1. GET `/api/invoices/:id/docx` streams the file with `Content-Disposition: attachment; filename="{invoice_number}.docx"`
1. Write `docs/PLACEHOLDERS.md` with complete reference + a sample template snippet
1. Provide a starter `template.docx` (committed under `docs/example-template.docx`) that admin can download as a starting point
1. Endpoint to download the example template
1. Handle missing placeholders gracefully (render as empty string with a warning logged)
1. Handle template parse errors with clear messages (line/column from docxtemplater)
1. Loop syntax in template: `{#labor_lines}…{/labor_lines}`
1. Conditional rendering: `{#if has_per_diem}Per Diem: {totals.per_diem_total}{/if}` — preprocess `has_*` flags into the data object
1. Currency formatting: pre-format in the data object (don’t rely on template filters)
1. Date formatting: pre-format invoice_date and through_date as `MM/DD/YYYY`
1. Unit tests: render against the example template with a fixture invoice; assert key strings present in output docx (unzip + check word/document.xml)
1. Unit tests: missing template returns clear error
1. Unit tests: loops render correct number of rows
1. E2E: upload custom template → render invoice → download → open in Word manually (smoke test documented in OPERATIONS.md)
1. Error surface: failed render shows in InvoiceDetailPage with logs link
1. Retry: 3 attempts with exponential backoff
1. Audit log on render
1. Document size limit: warn if generated docx > 10MB (likely runaway loop)
1. Confirm: round-trip from example template renders correctly with all sections populated

### Acceptance

- Customer-uploaded template renders with full placeholder substitution
- Loops and conditionals work
- Output is a valid docx openable in Word

-----

## Phase 15 — PDF Generation Worker

**Goal**: Convert the rendered docx to PDF using headless LibreOffice in a background worker.

**Dependencies**: Phase 14.

### Tasks

1. Ensure Dockerfile installs `libreoffice` (core + writer) — verify image size impact
1. Worker `docx-to-pdf` consumes `{ invoice_id }`
1. Spawn `libreoffice --headless --convert-to pdf --outdir <tmpdir> <docx_path>`
1. Use a per-job lockfile or per-tmpdir isolation to avoid LO concurrency issues (LO sometimes fails when multiple instances share `~/.config/libreoffice`)
1. Set `HOME=<tmpdir>` per spawn to fully isolate
1. Read converted PDF, move to `/storage/invoices/{invoice_id}.pdf`
1. Update `invoices.generated_pdf_path`
1. GET `/api/invoices/:id/pdf` streams the file with `Content-Disposition: attachment; filename="{invoice_number}.pdf"`
1. Timeout: 60s; on timeout, fail with clear error
1. Retry: 2 attempts (LO is finicky)
1. Health check: on app boot, run a one-time LO smoke conversion of a tiny docx and log result
1. Document LO version requirement (>= 7.5)
1. Unit test: convert a fixture docx; assert resulting file starts with `%PDF-`
1. E2E: finalize invoice → wait for PDF status ready → download → file opens
1. Failure surface: same retry UI as docx generation
1. Audit log on conversion
1. Log LO stderr on failure for troubleshooting
1. Confirm: conversion completes in < 10s for typical invoice

### Acceptance

- PDFs generated within 10s of finalize
- Failures surface to the UI with retry

-----

## Phase 16 — Invoice Void Workflow

**Goal**: Voiding a finalized invoice unbinds its entries (making them eligible for re-billing) and marks the invoice as void; the sequence number is not reused.

**Dependencies**: Phase 13.

### Tasks

1. POST `/api/invoices/:id/void` `{ reason: text }`
1. Transactional: set `status='void'`, set `voided_at=now()`, save `void_reason`, unbind all time_entries and expenses (set their `invoice_id=null`)
1. Add `void_reason` and `voided_by_user_id` columns to `invoices`
1. Voided invoices retain their sequence number for audit but are skipped in future MAX()+1 calculations (since query already filters `status != 'void'`)
1. Generated docx + pdf files retained on disk; can still be downloaded from voided invoice page (watermarked? — defer to v2)
1. Constraint: cannot void if a later non-void invoice for the same job depends on this one — actually, since entries are scoped to the invoice that bound them, no such dependency exists; allow void unconditionally
1. Frontend: “Void” button on `InvoiceDetailPage` for finalized invoices
1. Confirmation modal requires typing the invoice number + reason
1. Voided invoices clearly badged in lists (red “VOID” badge)
1. Voided invoices excluded from default invoice list filter; toggle to include
1. Audit log entry with reason
1. Unit tests: void unbinds all entries
1. Unit tests: voided invoice’s sequence number not reused
1. Unit tests: re-billing a voided invoice’s entries creates a new draft with the same entries selectable
1. E2E: finalize → void → entries appear unbilled → create new draft → re-finalize → new sequence number
1. Confirm: void event reflected in audit log

### Acceptance

- Void unbinds entries cleanly
- Sequence numbers skip voided invoices
- Voided invoices preserved for audit

-----

## Phase 17 — Email Delivery (Optional)

**Goal**: Optionally email the finalized invoice (docx + pdf) directly from the app via SMTP.

**Dependencies**: Phase 15.

### Tasks

1. Add SMTP fields to `settings`: `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password (encrypted at rest using AES-256-GCM with key from env)`, `smtp_from_address`, `smtp_from_name`, `smtp_enabled (bool)`
1. Encryption: key from `SMTP_ENC_KEY` env var (32 bytes); fail boot if missing when smtp_enabled=true
1. UI: Settings → Branding tab gets new “Email” sub-section
1. Test-connect button: sends a test email to a specified recipient
1. Drizzle table `invoice_emails`: `id`, `invoice_id`, `to_address`, `cc_addresses (text[])`, `subject`, `body`, `sent_at`, `sent_by_user_id`, `included_docx (bool)`, `included_pdf (bool)`, `smtp_message_id (nullable)`, `error (nullable)`
1. POST `/api/invoices/:id/email` `{ to, cc[], subject, body, include_docx, include_pdf }`
1. Worker `send-invoice-email` uses nodemailer with SMTP config
1. Default subject template: `Invoice {invoice_number} from {company_name}`
1. Default body template: short greeting + invoice number + total + “see attached”
1. Save sent record on success; save error on failure
1. Frontend: “Email Invoice” button on `InvoiceDetailPage` (only when SMTP enabled)
1. EmailModal: to (default to customer.contact_email), cc input (chips), subject + body editable, attachment checkboxes (both default checked)
1. Sent-history panel on InvoiceDetailPage showing all email attempts
1. Resend button on failed attempts
1. Validation: at least one attachment must be selected; at least one recipient
1. Rate limit: max 10 emails per hour per invoice (protect against spam)
1. Unit tests: AES round-trip for password; test-connect flow; body template substitution
1. E2E: configure SMTP (with mailhog in test env) → finalize invoice → email → mailhog receives with attachments
1. Audit log entry for each email sent
1. Confirm: download-only flow still works when SMTP disabled (default state)

### Acceptance

- SMTP configurable in Settings with encryption at rest
- Email sends include docx + pdf attachments
- Send history visible on invoice detail

-----

## Phase 18 — Historical XLSM Data Importer

**Goal**: One-time idempotent script that reads the legacy `Time_Allocation_Tracking.xlsm` and seeds: customers, jobs, employees, cost rates, time entries, and historical invoices (status=finalized with snapshot lines).

**Dependencies**: Phases 5–13.

### Tasks

1. Script: `scripts/import-xlsm.ts`, runs via `npx tsx scripts/import-xlsm.ts <path-to-xlsm> [--dry-run] [--only=customers,jobs,...]`
1. Use `exceljs` to read the file (handles datetimes + serials cleanly)
1. **Job-code parser** (`parseJobCode(code)`) — built first, since steps 4/6/7/8 depend on it. Rule for the observed format `D{YY}{CUST}{SEQ}[.{NN}]`:
- Strip the constant leading `D` (Darrow).
- Read the next 2 digits as the 2-digit year.
- The customer code is the alphabetic run that follows (1–2+ letters): match against the Companies code map (`J, B, NB, SC, D, G, EP, DS`), preferring the **longest** match (so `NB` beats `N`).
- The trailing digits are the job sequence; an optional `.NN` suffix is the historical billed reference and is **not** part of the job code.
- **Unmapped customer codes** (e.g. `MF`, which is absent from Companies): do not fail. Create a placeholder customer named `Unknown (MF)` with `active=false`, map the code to it, and add a warning to the report for manual reconciliation.
- Return `{ year, customer_code, customer_id, base_code, billed_suffix | null }`.
1. **Excel date helper** (`excelToDate(value)`): if `exceljs` already yields a JS `Date`, use it; if a raw serial, convert as date-only via the 1899-12-30 epoch (`new Date(Date.UTC(1899,11,30) + serial*86400000)`) and **truncate to date** (no TZ shift). Ignore fractional time-of-day. Unit-test against known anchors.
1. Step 1 — `Companies` sheet → upsert `customers` by name (preserve casing); build the `code → customer_id` map used everywhere below. Seed empty addresses for admin to fill.
1. Step 2 — `Employee Active` + `Defaults` → upsert `employees`; set `level_id` from the “Level” column (numeric `N` → “Apprentice Yr N”; `Journeyman`/`Foreman` → as-is). Create one open-ended `employee_cost_rates` row per employee. **Cost is unknown in the workbook** (the sheets hold *bill* rates, not cost), so seed cost_st/ot/dt = 0 and flag every employee in the report as **“cost rate = 0, REQUIRES manual entry.”** Do not use bill rates as a cost proxy (that would silently fabricate margins).
1. Step 3 — build per-customer `rate_schedules`: one schedule per customer, `effective_from = 1900-01-01`, open-ended. Derive each `level → {1x,1.5x,2x}` line by grouping the `Defaults` bill rates (within a customer, all employees of a level share a rate). **Sugar Creek’s flat $110** becomes a schedule where every level = 110/110/110 (it billed flat regardless of level). Because this reconstruction is lossy, mark all imported schedules in the report as **“derived from legacy data — REVIEW before issuing new invoices,”** mirroring the cost-rate caveat. The Diamond 15-day-period special scheme is **not** reconstructed — Diamond Pet Foods simply gets a standard derived schedule like every other customer (the customer is in scope; only its special rate logic is out of scope per round 1 #10).
1. Step 4 — `Job Codes` sheet (≈1,085 rows) → upsert `jobs` via `parseJobCode`; description from the sheet; `billing_type` from the `T/M Quote` column (`Quote` → `quote`, else `tm`). Batch inserts in chunks of 500.
1. Step 5 — `Time Recap` sheet (≈7,271 rows): **first verify the layout** — confirm column A (“Date”) is the week anchor and which weekday it represents, and confirm the day columns run Mon→Sun (the sheet is not perfectly weekly and the top “AAA” row is a fractional datetime placeholder to skip). Log the detected anchor weekday; if column A is, say, a Tuesday while the first day-column is “Mon”, offset accordingly rather than assuming `anchor == Monday`.
1. For each valid row, explode into up to 7 daily `time_entries` (one per weekday with any non-zero ST/OT/DT), `work_date = anchor_date + dayOffset(weekday)`. Skip the placeholder/junk top row(s). **Batch-insert in chunks of 1,000** (≈30k rows total).
1. Carry each row’s `Billed` value (column 33, e.g. `D24B001.01`) onto its exploded entries as a transient `billed_marker` for step 6b.
1. Step 6 — `Billed` sheet → create historical `invoices` with `status='finalized'`, `imported_from_xlsm=true`. **Deduplicate** identical rows first (the sheet contains exact duplicates, e.g. `D22J067` twice). For each distinct billed row, store the **original reference string verbatim** in `billed_reference`; parse `sequence_number` from the `.NN` suffix when numeric, else leave null. Do **not** synthesize fresh per-job sequences — preserving the original reference keeps the Time Recap ↔ Billed linkage intact (the suffixes are not all `.01`-based; values like `.70`/`.73` exist).
1. Step 6b — bind exploded time entries to invoices by matching `billed_marker` to the invoice’s `billed_reference`. Entries whose marker has no matching Billed row are left unbilled and reported.
1. Snapshot each historical invoice’s line items + persisted totals at import (run the Phase 11/13 pricing + snapshot path against the bound entries and the derived schedule). Because schedules/costs are flagged for review, note that historical snapshot dollars are best-effort reconstructions.
1. Step 7 — `Import From AW` sheet → for rows with a `Job` set, create `expenses`: `work_date` = Date, `vendor` = Description column, `reference` = Reference column (vendor invoice #), `amount` = `ABS(Amount)` (AW amounts are negative), `category` from the Account column (`5040 Job materials` → `materials`, `6250 Equipment rental` → `equipment_rent`, else → `materials` + warning), `imported_from_xlsm=true`. The AW `Job` value may carry a `.NN` suffix — strip it via `parseJobCode` to resolve the job; if the suffix matched a historical invoice, also bind the expense to that invoice.
1. Skip AW rows where `Job` is blank or resolves to a daily-sales bucket (code shape `D{YY}D{SEQ}` with the “Daily Sales” customer); log the skipped count. No attachments are imported (none exist in the workbook).
1. Idempotency: every step keyed off natural identifiers (customer name, employee name, job base_code, invoice `billed_reference`, expense `vendor+reference+date+amount`); re-running updates rather than duplicates.
1. Dry-run mode prints planned changes without writing; `--only` runs individual steps; CLI confirms before the write phase.
1. Output report → `/storage/imports/{timestamp}.log` + committed `docs/sample-import-report.md`: counts per entity (created/updated/skipped) and a warnings section covering: cost rates = 0, schedules need review, unmapped customer codes, ambiguous job codes, unmatched billed markers, AW category fallbacks, skipped daily-sales rows.
1. Add `imported_from_xlsm (bool default false)` to `customers`, `employees`, `jobs`, `time_entries`, `expenses`, `invoices` (invoices/expenses columns already added in their own phases; ensure the others exist).
1. Unit tests: `excelToDate` against known anchors (e.g. `45299` → 2024-01-08); `parseJobCode` for `D26NB048` (Nutra Blend), `D25D013.70` (Diamond, suffix `.70`), `D24MF001` (unmapped → placeholder), `D24SC001` (Sugar Creek)
1. Unit tests: weekly-row explosion into daily entries respecting the detected anchor weekday
1. Unit tests: Billed-sheet dedup; original `billed_reference` preserved verbatim; no synthetic sequence overwrites it
1. Unit tests: idempotent re-run produces zero net changes
1. Integration test: run against a small fixture xlsm checked into `packages/db/test/fixtures/`; assert table row counts and that one historical invoice’s totals equal its snapshot lines
1. Document the full import procedure in `docs/OPERATIONS.md`: **backup first**, dry-run, review log, run for real, then **manually set employee cost rates and review every derived rate schedule** before issuing any new invoice
1. Surface imported historical invoices with a “Historical” badge; their `generated_docx_path`/`generated_pdf_path` are null
1. Allow regenerating docx/pdf for a historical invoice via a “Regenerate” button (requires an uploaded template)
1. Performance: full run completes in < 5 minutes using batched inserts
1. Confirm: report shows ≈1,085 jobs / 9 customers (+ any placeholder) / ≈30k daily time entries / ≈2,700 expenses; spot-check that `D24B001.01` binds the right Time Recap rows

### Acceptance

- One command imports the full xlsm idempotently
- Employee cost rates seeded at 0 and flagged as REQUIRING manual entry; derived rate schedules flagged for review
- Historical invoices preserve their original `billed_reference` strings; Time Recap entries bind to the correct invoice
- Unmapped customer codes produce placeholder customers + warnings rather than failing

-----

## Phase 19 — Reports v1 + Readiness Dashboard

**Goal**: Provide three reports that replicate the most-used pivot tables from the original workbook.

**Dependencies**: Phase 13.

### Tasks

1. Report 1 — **Hours by Employee for Job/Invoice**: input job_id (and optional invoice_id), output table of `employee × tier × hours` with totals; mirrors `Billed_Employee_Hours` pivot
1. Report 2 — **Time Detail for Job/Invoice**: input job_id (and optional invoice_id), output detail rows (date, employee, st/ot/dt hours, computed bill amount); mirrors `Hours_by_Job` pivot
1. Report 3 — **Expense List for Job/Invoice**: input job_id (and optional invoice_id), output expense detail (date, vendor, category, description, amount, # attachments, markup, total); mirrors `Materials_Recap` pivot
1. GET `/api/reports/employee-hours?job_id=&invoice_id=`
1. GET `/api/reports/time-detail?job_id=&invoice_id=`
1. GET `/api/reports/expense-list?job_id=&invoice_id=`
1. Each endpoint supports `format=json|csv|pdf` query
1. CSV: server generates with `csv-stringify`
1. PDF: render via a simple html-to-pdf path using puppeteer-core OR by composing a docx via docxtemplater + LO conversion (choose puppeteer for consistency with web rendering)
1. Frontend: `ReportsPage` with three cards; each opens a `ReportViewer` with filter bar (job/invoice select), table, and download-as buttons
1. Filter combo: when invoice_id is selected, scope to entries bound to that invoice; otherwise all entries for the job
1. Filter combo: when only job_id is selected, can further filter date range
1. Tables use TanStack Table with sorting and column resize
1. Show totals row at the bottom of each report
1. Empty state when no data matches
1. Loading skeleton while query runs
1. Unit tests: each report’s data shape against a fixture
1. Unit tests: CSV output matches table data
1. E2E: open each report → filter by historical job → download CSV → assert contents
1. Performance: report endpoints should return in <500ms for jobs with up to 1,000 entries
1. Add report links from `JobDrawer` and `InvoiceDetailPage`
1. Pagination not needed for v1 (typical job has < 500 entries)
1. Audit log entries for report exports (CSV/PDF downloads)
1. Document the deferred reports list in `docs/OPERATIONS.md` (WIP-by-job, job profitability cost-vs-bill, employee summary across jobs — for v2)
1. Add “View report” deep-link buttons on InvoiceDetailPage
1. Mention in UI that PDF report rendering is best-effort
1. Confirm: each report works for both an in-progress draft and a finalized invoice
1. Confirm: reports for historical (imported) invoices render correctly
1. **Readiness dashboard** (consolidates the warnings scattered across phases): GET `/api/reports/readiness` returns counts + drill-down lists for — jobs whose customer has no rate schedule covering today, active employees with no current cost rate (or cost rate = 0), expenses with a `failed` attachment conversion, and drafts older than 30 days. Render as a `ReadinessPage` card grid with each issue linking to the entity to fix. This is the single screen the admin checks after the historical import and before issuing new invoices.
1. Unit tests: readiness query flags a job without a covering schedule and an employee with cost = 0

### Acceptance

- All three reports work with the requested filters
- CSV and PDF downloads work
- Deferred reports list captured for future work

-----

## Phase 20 — Deployment, Backup, Operations

**Goal**: Make this production-deployable on a self-hosted Linux box with clean backup/restore, accessible documentation, and observable logs.

**Dependencies**: all prior phases.

### Tasks

1. Final `docker/Dockerfile`: multi-stage, runtime stage based on `node:20-bookworm-slim`, installs `libreoffice-core libreoffice-writer`, copies built app, runs as non-root user
1. Final `docker/docker-compose.prod.yml`: services for `app`, `postgres:16-alpine`, `redis:7-alpine`, with named volumes for postgres data, redis data, and `/storage`
1. Restart policy `unless-stopped` on all services
1. Healthchecks defined in compose for all three services
1. App container exposes only port 3000; reverse-proxy expected to terminate TLS upstream (document Caddy or nginx examples)
1. Example `Caddyfile` in `docker/examples/Caddyfile` for HTTPS with auto cert
1. GHCR workflow tags: `:latest`, `:v{major}.{minor}.{patch}`, `:sha-{short}`
1. README quick-start: pull image, fill `.env`, `docker compose up -d`, run `bootstrap-admin`, log in
1. Backup script `scripts/backup.sh`: pg_dump (custom format) + tar of `/storage` → single timestamped `.tar.gz` written to a configurable backup dir. **Redis is intentionally not backed up** — it holds only sessions and transient queues; document this so the omission isn’t mistaken for a gap.
1. Restore script `scripts/restore.sh`: takes a backup archive, restores both
1. Document recommended cron: nightly backup + 30-day retention via simple find-delete
1. Add `docs/BACKUP.md` with full procedure
1. Add `docs/OPERATIONS.md` with: log access, troubleshooting common issues (LO conversion failures, image-to-PDF failures, session loss), updating to a new release, restoring from backup
1. Add `docs/UPGRADE.md`: migration workflow on version bump (always run migrations before booting new image)
1. Logs: ensure all services log to stdout in JSON; recommend `docker compose logs` or `journalctl` workflow
1. Add `app/api/src/error-handler.ts`: catches all errors, logs with request context, returns the standard `{ ok: false, error }` envelope
1. Add Sentry stub (env-gated, off by default) for future error tracking
1. Bundle size budget: monitor frontend bundle, lazy-load report pages
1. Lighthouse audit on key pages; target performance >= 90
1. Security: `helmet` middleware; CSP that allows `'self'` only; CSRF protection via SameSite cookie + custom header check on mutating requests
1. Verify all uploaded files are validated by content-type sniffing (not just extension)
1. File-storage permissions: 0700 on `/storage` mount; files written 0600
1. Document recommended firewall (only 80/443 exposed) in `docs/OPERATIONS.md`
1. Add `version` field in `package.json` reflected in `/api/health`
1. Bootstrap admin password: enforce min length 16 on bootstrap script
1. Add `pnpm db:reset` (drop + migrate + seed) — guarded by `NODE_ENV=development`
1. Final smoke test checklist in `docs/SMOKETEST.md`: 12 steps from login through a full invoice cycle including void and reissue
1. Tag `v1.0.0` once smoke test passes
1. Push image to GHCR
1. Confirm: a fresh box can go from empty Postgres → working invoice in < 30 minutes following docs

### Acceptance

- Production deployment is reproducible from docs alone
- Backup/restore round-trip works
- Smoke test passes end-to-end

-----

## §3. Appendix A — Expense Category Reference

|Enum value      |Display label    |Default markup (settings)|Notes                                                         |
|----------------|-----------------|-------------------------|--------------------------------------------------------------|
|`materials`     |Materials & Parts|15%                      |Default markup carried from xlsm                              |
|`equipment_rent`|Equipment Rent   |10%                      |Default markup carried from xlsm                              |
|`truck_rental`  |Truck Rental     |0%                       |Per-day rate × days replaced by expense entries per round 3 #4|
|`per_diem`      |Per Diem         |0%                       |Same as truck rental                                          |
|`travel`        |Travel           |0%                       |Currently passes through; admin can override                  |
|`freight`       |Freight          |0%                       |Currently passes through                                      |
|`stock_material`|Stock Material   |0%                       |Shop-stock items                                              |

-----

## §4. Appendix B — Docx Placeholder Reference (preview — full text in `docs/PLACEHOLDERS.md`)

```
{company.name}                       Settings → Company
{company.address}                    Multi-line
{company.phone}
{company.email}
{logo}                               Image placeholder (use image module syntax)

{customer.name}
{customer.bill_to_address}           Multi-line

{job.code}
{job.description}
{job.po_number}
{job.billing_type_label}             "Time & Materials" or "Quote"
{job.site_address}                   Multi-line (or empty)

{invoice.number}                     e.g., D26NB048.01
{invoice.date}                       Finalized date, MM/DD/YYYY
{invoice.through_date}               MM/DD/YYYY
{invoice.notes}

{totals.labor}                       Pre-formatted "$1,234.56"
{totals.materials}
{totals.equipment_rent}
{totals.truck_rental}
{totals.per_diem}
{totals.travel}
{totals.freight}
{totals.stock_material}
{totals.grand_total}

{#labor_lines}
  {employee_name} – {tier_label} – {hours} hrs @ {rate} = {amount}
{/labor_lines}

{#expense_lines_flat}
  {category_label} – {vendor} – {description} – {amount}
{/expense_lines_flat}

{#markup_lines}
  {category_label} Markup ({percent_label}) = {amount}
{/markup_lines}

{#if has_per_diem}…{/if}              Conditional sections per category
```

-----

## §5. Appendix C — Historical XLSM Sheet → DB Table Mapping (importer reference)

|XLSM Sheet                                |Destination                                                  |Notes                                                                                         |
|------------------------------------------|-------------------------------------------------------------|----------------------------------------------------------------------------------------------|
|Companies                                 |`customers`                                                  |Code → customer_id map used by Job Codes importer                                             |
|Defaults                                  |`employees` bill rates → `rate_schedule_lines`               |Schedules derived per customer, `effective_from=1900-01-01`; flagged for review               |
|Employee Active                           |`employees.level_id` + initial `employee_cost_rates` (cost=0)|Cost seeded at 0 — admin must enter real costs                                                |
|Job Codes                                 |`jobs`                                                       |Customer resolved by `parseJobCode` (longest-match; unmapped → placeholder)                   |
|Time Recap                                |`time_entries` (exploded daily)                              |Verify anchor weekday first; each row → up to 7 daily rows                                    |
|Billed                                    |`invoices` (status=finalized)                                |Original `billed_reference` preserved verbatim; rows deduped                                  |
|Import From AW                            |`expenses`                                                   |Rows with Job set; `reference`=vendor invoice #; category from Account                        |
|PayRates                                  |(ignored)                                                    |Holds gross hourly pay, not loaded cost; deferred to manual entry                             |
|App Percent Journeyman                    |(consulted)                                                  |Reference for apprentice level mapping                                                        |
|Diamond Rates / Diamond Weeks             |(ignored)                                                    |15-day special rate scheme out of scope; Diamond Pet Foods still imported as a normal customer|
|UnionFees                                 |(ignored)                                                    |Out of scope                                                                                  |
|Bill Compare / Job Check / Sheet1–4 / etc.|(ignored)                                                    |Out of scope                                                                                  |

-----

## §6. Execution Notes for Autonomous Claude Code

1. Work the phases in order. Each phase has its own commit (`feat(phase-N): <title>`).
1. After each phase, run the full test suite + lint. Do not advance until green.
1. For any ambiguity or design fork not covered above, append to `QUESTIONS.md` at the repo root and continue with the most reasonable default — flag the decision in the commit message.
1. Run `npm run db:migrate` after every schema change; commit the generated SQL.
1. Update `README.md` after Phase 1, Phase 2, Phase 18, and Phase 20 (the user-facing milestones).
1. After Phase 18 (importer), produce a sample import report against the provided `Time_Allocation_Tracking.xlsm` fixture and commit it under `docs/sample-import-report.md`.
1. After Phase 20, run the full `docs/SMOKETEST.md` checklist and report results in `docs/smoketest-results-v1.0.0.md`.

-----

*End of build plan.*