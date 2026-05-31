# Smoke Test Checklist (v1.0.0)

Run the full lifecycle end to end. The automated equivalent is `npm run smoke`
(`scripts/smoke.ts`), which drives every step below over real HTTP with the real workers.

| # | Step | Expected |
|---|---|---|
| 1 | `npm run bootstrap` then sign in at `/login` | Admin session established |
| 2 | Settings → Company + upload logo + upload template (`docs/example-template.docx`) | Saved; template downloadable round-trip |
| 3 | Create a customer (bill-to address) | Appears in Customers |
| 4 | Customer → Rate Schedule → fill matrix → set default | Schedule active for today |
| 5 | Create an employee + add a cost rate | Cost rate badge green |
| 6 | Create a job (free-form code) | Appears in Jobs |
| 7 | Time Grid → add row → enter ST/OT/DT, blur | Cells auto-save; totals update |
| 8 | Expenses → new expense → upload an image attachment | Status goes pending → ready (PDF) |
| 9 | Invoices → New Draft (job + through-date) | Time + expenses auto-selected; preview totals correct, no blockers |
| 10 | Finalize | `billed_reference` `{code}.01`; docx + pdf become ready |
| 11 | Download DOCX and PDF | Valid `.docx` (PK) and `.pdf` (`%PDF-`) |
| 12 | Void with reason, then New Draft + Finalize again | Reissued as `{code}.02` (voided number not reused) |
| 13 | Reports → run all three for the job (+ CSV) | Rows render; CSV downloads |
| 14 | Readiness | All four cards reflect real counts |

A pass requires every row green. Record results in
`docs/smoketest-results-v1.0.0.md`.
