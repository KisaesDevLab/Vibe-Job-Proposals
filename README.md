# Darrow Time & Invoicing

A single-tenant web application that replaces the legacy `Time_Allocation_Tracking.xlsm`
workbook for Darrow Electric: track field-electrician time by day/job/employee/tier, log
job expenses with receipt attachments, and generate customer invoices (DOCX + PDF) that
combine billed time and expenses with configurable per-customer markups.

Built per [`CLAUDE.md`](./CLAUDE.md) (the full 20-phase build plan). UI follows
[`docs/mockup.html`](./docs/mockup.html) — charcoal + copper.

## Stack

React 18 + TypeScript + Vite + TanStack Router/Query + Tailwind · Node 20 + Express ·
PostgreSQL 16 + Drizzle · Redis 7 + BullMQ · docxtemplater + LibreOffice (DOCX→PDF) ·
sharp + pdf-lib (image→PDF). npm workspaces monorepo.

```
apps/web   React SPA          packages/shared   zod schemas + pricing engine
apps/api   Express API        packages/db       Drizzle schema + numbered migrations
                              packages/workers  BullMQ workers (image→pdf, docx, pdf, email)
```

## Quick start (Docker)

```bash
cp .env.example .env            # fill SESSION_SECRET (and SMTP_ENC_KEY if using email)
docker compose -f docker/docker-compose.prod.yml up -d
# create the first admin (prints a generated password if none given):
docker compose -f docker/docker-compose.prod.yml exec app npx tsx scripts/bootstrap-admin.ts admin
```
Open `http://localhost:3000` and sign in. Put a reverse proxy (see
`docker/examples/Caddyfile`) in front for HTTPS.

## Local development

```bash
docker compose -f docker/docker-compose.yml up -d   # Postgres + Redis
npm install
npm run db:migrate && npm run db:seed
npm run bootstrap                                    # creates admin, writes docs/FIRST_RUN.md
npm run dev                                          # api :4000 + web :5173
npm run dev:workers                                  # workers (separate terminal)
```

### Seed defaults
- 9 customers (Jasper Products, Bagcraft, Nutra Blend, Sugar Creek, Diamond Pet Foods,
  Graham Packaging, Modine, Eagle Picher, Darlington) with blank addresses to fill in.
- 9 rate levels (Foreman, Journeyman, Apprentice Yr 1–7).
- Markup defaults: materials 15%, equipment rent 10%, others 0%.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | API + web together |
| `npm run build` | Build all workspaces |
| `npm run lint` / `npm run type-check` / `npm test` | Green gate |
| `npm run db:migrate` / `db:seed` / `db:reset` | Database |
| `npm run bootstrap` | Create first admin |
| `npm run import:xlsm -- <file.xlsm>` | Historical import (Phase 18) |
| `npm run smoke` | Automated end-to-end smoke test |

## Docs
- [SMOKETEST](./docs/SMOKETEST.md) · [OPERATIONS](./docs/OPERATIONS.md) ·
  [BACKUP](./docs/BACKUP.md) · [UPGRADE](./docs/UPGRADE.md) ·
  [PLACEHOLDERS](./docs/PLACEHOLDERS.md)
- Autonomous build decisions: [QUESTIONS.md](./QUESTIONS.md)

## License
PolyForm Internal Use License 1.0.0 — see [LICENSE.md](./LICENSE.md).
