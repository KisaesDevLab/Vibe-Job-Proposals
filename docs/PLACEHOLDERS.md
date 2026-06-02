# Docx Template Placeholder Reference

The invoice renderer (Phase 14) uses [docxtemplater](https://docxtemplater.com/).
Upload your `.docx` under **Settings → Branding**. A starter template is available at
`docs/example-template.docx` (downloadable from the Branding tab).

**All numeric values are read from the persisted invoice snapshot** (`invoices.total_*`
and `invoice_line_items`), never recomputed from rate tables — so a finalized invoice
renders identically forever, even if rate schedules change later.

## Scalar placeholders

| Placeholder | Source |
|---|---|
| `{company.name}` | Settings → Company |
| `{company.address}` | Multi-line (line1/line2/city, state zip) |
| `{company.phone}` | Settings |
| `{company.email}` | Settings |
| `{customer.name}` | Invoice's job's customer |
| `{customer.bill_to_address}` | Multi-line |
| `{job.code}` | Job |
| `{job.description}` | Job |
| `{job.po_number}` | Job |
| `{job.billing_type_label}` | "Time & Materials" or "Quote" |
| `{job.site_address}` | Multi-line (or empty) |
| `{invoice.number}` | `billed_reference`, e.g. `D26NB048.01` |
| `{invoice.date}` | Finalized date, MM/DD/YYYY |
| `{invoice.through_date}` | MM/DD/YYYY |
| `{invoice.notes}` | Invoice notes |
| `{totals.labor}` | Pre-formatted `$1,234.56`. Includes the overhead line. |
| `{totals.materials}` | Materials raw cost **+** its markup |
| `{totals.equipment_rent}` | Equipment rent + its markup |
| `{totals.truck_rental}` | Truck rental + its markup |
| `{totals.per_diem}` | Per diem + its markup |
| `{totals.travel}` | Travel + its markup |
| `{totals.freight}` | Freight + its markup |
| `{totals.stock_material}` | Stock material + its markup |
| `{totals.markup}` | Total markup across all categories (kept for templates that show a separate markup line) |
| `{totals.grand_total}` | Grand total |

Each category total is the customer-facing all-in amount — raw expense
amount plus that category's markup. `{totals.markup}` still exposes the
total markup separately if your template lists it on its own line; don't
double-count it.

## Loops

```
{#labor_lines}
  {employee_name} – {tier_label} – {hours} hrs @ {rate} = {amount}
{/labor_lines}

{#expense_lines_flat}
  {category_label} – {vendor} – {description} – {amount}
{/expense_lines_flat}

{#markup_lines}
  {category_label} Markup = {amount}
{/markup_lines}
```

`expense_lines_by_category` is also provided (an object keyed by category label) for
grouped layouts.

## Conditionals (per-category `has_*` flags)

```
{#has_per_diem}Per Diem: {totals.per_diem}{/has_per_diem}
{#has_materials}Materials: {totals.materials}{/has_materials}
{#has_markup}…markup section…{/has_markup}
```

Available flags: `has_labor`, `has_materials`, `has_equipment_rent`, `has_truck_rental`,
`has_per_diem`, `has_travel`, `has_freight`, `has_stock_material`, `has_markup`.

## Notes

- Missing placeholders render as an empty string (a warning is logged).
- Currency and dates are pre-formatted in the data object; do not apply template filters.
- A generated docx larger than 10 MB logs a warning (likely a runaway loop).
