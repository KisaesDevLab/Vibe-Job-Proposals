# Smoke Test Results — v1.0.0

**Date:** 2026-05-29
**Method:** `npm run smoke` (`scripts/smoke.ts`) — single process running the real API
server + real BullMQ workers (image→pdf, render-docx, docx→pdf) + LibreOffice, driving
the full lifecycle over HTTP. Mirrors the manual checklist in `docs/SMOKETEST.md`.

## Result: ✅ PASSED

| Step | Result |
|---|---|
| Sign in | ✅ logged in |
| Customer + rate schedule (matrix + set default) | ✅ |
| Employee + cost rate | ✅ |
| Job + time entries (ST/OT/DT) | ✅ |
| Expense + image attachment → PDF (image-to-pdf worker) | ✅ converted to PDF |
| Invoice draft (auto-bind, preview) | ✅ preview grand total $2,909.33, no blockers |
| Finalize (snapshot + sequence) | ✅ `D26SMK….01` |
| DOCX + PDF generation (render-docx + docx-to-pdf workers) | ✅ both ready |
| Download DOCX (7,754 b, `PK…`) + PDF (29,457 b, `%PDF-`) | ✅ valid files |
| Reports: employee-hours, time-detail, expense-list | ✅ rows returned |
| Readiness dashboard | ✅ live counts |
| Void + reissue | ✅ reissued `…​.02` (voided sequence not reused) |

## Green gate
- `npm run type-check` — ✅ clean
- `npm run lint` — ✅ clean
- `npm test` — ✅ 43 passed (8 supertest API integration, image-to-pdf, docx render, pricing, importer); DB-gated suites run in CI

## Pricing verification
8h ST + 4h OT @ $110/$165 + 8h ST = 16×110 + 4×165 + ... and a $425.50 materials expense
@ 15% markup → grand total $2,909.33, matching the immutable snapshot to the cent.

## Notes
- Phase 18 importer verified separately against the synthetic fixture
  (`docs/sample-import-report.md`); idempotent re-run produces no duplicate rows.
- Production deployment via `docker/docker-compose.prod.yml`; migrations run on boot.

---

## Post-launch QA hardening (2026-05-30)

Two-pass pre-production QA (security + correctness review agents + dynamic probing).

- **Dependencies:** `npm audit --omit=dev` → **0 vulnerabilities** (removed unused
  xmldom-pulling module; bumped nodemailer/file-type/drizzle past their CVEs).
- **Security:** 64-hex `SMTP_ENC_KEY` enforced (no weak fallback); public-upload caps +
  storage guard; SMTP-test recipient locked to the From address; session regeneration on
  login; CSP frame-ancestors/object-src/base-uri; error handler no longer leaks
  library/driver messages; request timeouts; 1MB JSON cap.
- **Correctness:** atomic `/time/cell` tier-merge (lost-update fix) + value-keyed cells
  (stale-display fix); inbox processed inside its txn (no duplicate expense); docx renders
  markup % and resolves names/vendors by id-join; cache-key invalidations tightened.
- **Added:** Change-Password UI; `docs/` shipped in the Docker runtime image.

Final gate (clean DB from scratch): 16 migrations, bootstrap, **62 tests**, lint,
type-check, full build, smoke, and `audit.ts` 37/37 — all green. Production-ready.
