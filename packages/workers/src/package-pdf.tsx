// React-PDF document that renders the 4 cover pages of the invoice package:
//   1. Proposal (cover) — modeled on the legacy Excel proposal sheet
//   2. Employee Hours pivot (ST/OT/DT per employee)
//   3. General Hours Entry — landscape weekly grid (Mon-Sun × 1x/1.5x/2x)
//   4. Materials Invoice List — vendor → reference × category pivot
// Vendor receipts (page 5+) are concatenated by render-package.ts via pdf-lib.
import * as React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
void React;
import { formatMoney, EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@darrow/shared';
import type { PackageData } from './package-data.js';

Font.registerHyphenationCallback((w) => [w]); // disable hyphenation

const colors = {
  ink: '#000',
  muted: '#555',
  line: '#000',
  thinLine: '#bbb',
  excelHeader: '#4472c4',
  excelHeaderText: '#fff',
  excelBand: '#d9e1f2',
  excelSubtotal: '#5b9bd5',
};

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 36, paddingHorizontal: 48, fontSize: 10, fontFamily: 'Helvetica', color: colors.ink },
  pageLandscape: { paddingTop: 24, paddingBottom: 24, paddingHorizontal: 24, fontSize: 8, fontFamily: 'Helvetica', color: colors.ink },
  // Header (page 1)
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  companyName: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  companyAddr: { fontSize: 10, lineHeight: 1.3 },
  email: { color: '#1155cc', textDecoration: 'underline' },
  proposalTitle: { fontSize: 20, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  proposalNum: { fontSize: 10, textAlign: 'right' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginBottom: 12 },
  billTo: { width: '50%' },
  billToLabel: { fontFamily: 'Helvetica-Bold' },
  metaTable: { width: 360 },
  metaLabel: { fontFamily: 'Helvetica-Bold', textAlign: 'right', marginRight: 6 },
  // Tables (page 1 main)
  mainTable: { borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  thRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line },
  th: { padding: 4, fontFamily: 'Helvetica-Bold', textAlign: 'center', borderRightWidth: 1, borderColor: colors.line },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: colors.thinLine },
  td: { padding: 4, borderRightWidth: 1, borderColor: colors.line },
  bandRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line, backgroundColor: '#f0f0f0' },
  italicCenter: { fontStyle: 'italic', textAlign: 'center' },
  // Excel-style summary header bands (pages 2-4)
  excelHeader: { backgroundColor: colors.excelHeader, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold', padding: 4 },
  excelBand: { backgroundColor: colors.excelBand, padding: 3 },
  excelSubtotal: { backgroundColor: colors.excelSubtotal, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold', padding: 3 },
  pivotRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: colors.thinLine },
  // Signature (page 1 footer)
  sig: { flexDirection: 'row', marginTop: 28, alignItems: 'flex-end' },
  sigLine: { borderBottomWidth: 1, borderColor: colors.ink, flex: 1, marginLeft: 8 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Page 1 — Proposal
// ─────────────────────────────────────────────────────────────────────────────
function ProposalPage({ d, pageCount }: { d: PackageData; pageCount: number }) {
  const inv = d.invoiceData;
  // The snapshot stores one labor line per (employee × tier × time_entry);
  // the cover page aggregates back to one row per (employee, tier).
  const labor = aggregateLabor(inv.labor_lines ?? []);
  const expenseFlat = inv.expense_lines_flat ?? [];
  const markup = inv.markup_lines ?? [];
  const totals = inv.totals ?? {};

  // Aggregate expenses by category for clean cover-page presentation.
  const expByCat = new Map<string, { label: string; amount: number }>();
  for (const e of expenseFlat) {
    const cur = expByCat.get(e.category_label) ?? { label: e.category_label, amount: 0 };
    cur.amount += parseFloat(String(e.amount).replace(/[$,]/g, '')) || 0;
    expByCat.set(e.category_label, cur);
  }

  return (
    <Page size="LETTER" style={s.page}>
      {/* Top header — company left, "Proposal" right */}
      <View style={s.headerRow}>
        <View>
          <Text style={s.companyName}>{inv.company?.name}</Text>
          {(inv.company?.address ?? '').split('\n').map((line: string, i: number) => (
            <Text key={i} style={s.companyAddr}>{line}</Text>
          ))}
          {inv.company?.phone ? <Text style={s.companyAddr}>{inv.company.phone}</Text> : null}
        </View>
        <View>
          <Text style={s.proposalTitle}>Proposal</Text>
          <Text style={s.proposalNum}>1 of {pageCount}</Text>
        </View>
      </View>

      {/* Email + date/bill# */}
      <View style={s.headerRow}>
        <Text style={s.email}>{inv.company?.email}</Text>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: 60 }}>
            <Text style={s.metaLabel}>Date:</Text>
            <Text style={s.metaLabel}>Bill #:</Text>
          </View>
          <View style={{ width: 90 }}>
            <Text>{inv.invoice?.date}</Text>
            <Text>{inv.invoice?.number}</Text>
          </View>
        </View>
      </View>

      {/* Job description — one line under Bill # with breathing room before
          the Bill To / Job # block below. Right-aligned (marginLeft: auto +
          width 280) so its "Description:" label lines up with the left edge
          of the Job # / PO # / Customer # table that follows. */}
      {inv.job?.description ? (
        <View style={{ flexDirection: 'row', marginLeft: 'auto', width: 280, marginBottom: 10 }}>
          <Text style={[s.metaLabel, { width: 70 }]}>Description:</Text>
          <Text style={{ flex: 1 }}>{inv.job.description}</Text>
        </View>
      ) : null}

      {/* Bill To + Job/PO/Customer */}
      <View style={s.metaRow}>
        <View style={s.billTo}>
          <Text style={s.billToLabel}>Bill To:</Text>
          <Text>{inv.customer?.name}</Text>
          {(inv.customer?.bill_to_address ?? '').split('\n').map((line: string, i: number) => (
            <Text key={i}>{line}</Text>
          ))}
        </View>
        <View style={{ width: 280 }}>
          <View style={[s.thRow, { borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1 }]}>
            <Text style={[s.th, { width: '34%' }]}>Job #</Text>
            <Text style={[s.th, { width: '33%' }]}>PO #</Text>
            <Text style={[s.th, { width: '33%', borderRightWidth: 0 }]}>Customer #</Text>
          </View>
          <View style={[s.tr, { borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1 }]}>
            <Text style={[s.td, { width: '34%' }]}>{inv.job?.code}</Text>
            <Text style={[s.td, { width: '33%' }]}>{inv.job?.po_number}</Text>
            <Text style={[s.td, { width: '33%', borderRightWidth: 0 }]}> </Text>
          </View>
        </View>
      </View>

      {/* Main table */}
      <View style={s.mainTable}>
        <View style={s.thRow}>
          <Text style={[s.th, { width: '50%' }]}>Description</Text>
          <Text style={[s.th, { width: '17%' }]}>Rate</Text>
          <Text style={[s.th, { width: '17%' }]}>Est. Hours{'\n'}Qty</Text>
          <Text style={[s.th, { width: '16%', borderRightWidth: 0 }]}>Total</Text>
        </View>
        <View style={s.bandRow}>
          <Text style={[s.td, { width: '50%', textAlign: 'center', fontFamily: 'Helvetica-Bold' }]}>
            Summary Thru {inv.invoice?.through_date}
          </Text>
          <Text style={[s.td, { width: '17%' }]}> </Text>
          <Text style={[s.td, { width: '17%' }]}> </Text>
          <Text style={[s.td, { width: '16%', borderRightWidth: 0 }]}> </Text>
        </View>

        {/* Labor section */}
        {labor.length > 0 && (
          <>
            <View style={s.tr}>
              <Text style={[s.td, { width: '50%', fontFamily: 'Helvetica-Bold' }]}>Labor</Text>
              <Text style={[s.td, { width: '17%' }]}> </Text>
              <Text style={[s.td, { width: '17%' }]}> </Text>
              <Text style={[s.td, { width: '16%', borderRightWidth: 0 }]}> </Text>
            </View>
            {labor.map((l: any, i: number) => (
              <View style={s.tr} key={`lab-${i}`}>
                <View style={[s.td, { width: '50%', flexDirection: 'row', justifyContent: 'space-between' }]}>
                  <Text>{l.employee_name}</Text>
                  <Text>{tierMult(l.tier_label)} Standard Hourly Rate</Text>
                </View>
                <Text style={[s.td, { width: '17%', textAlign: 'right' }]}>{stripDollar(l.rate)}</Text>
                <Text style={[s.td, { width: '17%', textAlign: 'right' }]}>{l.hours.toFixed(2)}</Text>
                <Text style={[s.td, { width: '16%', borderRightWidth: 0, textAlign: 'right' }]}>{stripDollar(l.amount)}</Text>
              </View>
            ))}
            <View style={[s.tr, { borderTopWidth: 0.5, borderColor: colors.line }]}>
              <Text style={[s.td, { width: '50%', fontFamily: 'Helvetica-Bold' }]}>Subtotal - Labor</Text>
              <Text style={[s.td, { width: '17%' }]}> </Text>
              <Text style={[s.td, { width: '17%', textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>
                {laborHoursTotal(labor).toFixed(2)}
              </Text>
              <Text style={[s.td, { width: '16%', borderRightWidth: 0, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>
                {stripDollar(totals.labor)}
              </Text>
            </View>
          </>
        )}

        {/* Expense sections by category, with markup line if any */}
        {[...expByCat.values()].map((cat, i) => {
          const mk = markup.find((m: any) => m.category_label === cat.label);
          return (
            <View key={`cat-${i}`}>
              <View style={s.tr}>
                <Text style={[s.td, { width: '50%' }]}>{cat.label}</Text>
                <Text style={[s.td, { width: '17%', textAlign: 'right' }]}>{stripDollar(cat.amount)}</Text>
                <Text style={[s.td, { width: '17%' }]}> </Text>
                <Text style={[s.td, { width: '16%', borderRightWidth: 0, textAlign: 'right' }]}>{stripDollar(cat.amount)}</Text>
              </View>
              {mk && (
                <View style={s.tr}>
                  <Text style={[s.td, { width: '50%' }]}>{mk.percent_label} Markup on {cat.label}</Text>
                  <Text style={[s.td, { width: '17%', textAlign: 'right' }]}>{mk.percent_label}</Text>
                  <Text style={[s.td, { width: '17%', textAlign: 'right' }]}>{stripDollar(cat.amount)}</Text>
                  <Text style={[s.td, { width: '16%', borderRightWidth: 0, textAlign: 'right' }]}>{stripDollar(mk.amount)}</Text>
                </View>
              )}
            </View>
          );
        })}

        {/* Totals block at bottom-right */}
        <View style={[s.tr, { borderTopWidth: 1, borderColor: colors.line }]}>
          <Text style={[s.td, { width: '50%', textAlign: 'center', fontStyle: 'italic' }]}>
            Thank you for your business!
          </Text>
          <View style={{ width: '50%' }}>
            <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderColor: colors.thinLine }}>
              <Text style={[s.td, { width: '50%', fontFamily: 'Helvetica-Bold' }]}>Labor</Text>
              <Text style={[s.td, { width: '50%', textAlign: 'right', borderRightWidth: 0 }]}>{stripDollar(totals.labor)}</Text>
            </View>
            <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderColor: colors.thinLine }}>
              <Text style={[s.td, { width: '50%', fontFamily: 'Helvetica-Bold' }]}>Materials & Parts</Text>
              <Text style={[s.td, { width: '50%', textAlign: 'right', borderRightWidth: 0 }]}>
                {(expenseTotalIncludingMarkup(expByCat, markup)).toFixed(2)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: '#f0f0f0' }}>
              <Text style={[s.td, { width: '50%', fontFamily: 'Helvetica-Bold' }]}>Total</Text>
              <Text style={[s.td, { width: '50%', textAlign: 'right', borderRightWidth: 0, fontFamily: 'Helvetica-Bold' }]}>
                {stripDollar(totals.grand_total)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Signature */}
      <View style={s.sig}>
        <Text>SIGNATURE:</Text>
        <View style={s.sigLine} />
      </View>
    </Page>
  );
}

// "1.0 X" / "1.5 X" / "2.0 X" prefix matching the legacy Excel verbiage.
function tierMult(label: string): string {
  if (/double/i.test(label)) return '2.0 X';
  if (/over/i.test(label)) return '1.5 X';
  return '1.0 X';
}

type LaborRow = { employee_name: string; tier_label: string; hours: number; rate: string; amount: string; is_overhead: boolean };
function aggregateLabor(rows: any[]): LaborRow[] {
  // Group by (employee, tier, unit_rate, is_overhead). Keying on rate ensures
  // a mid-invoice promotion (same employee/tier, different rates across dates)
  // emits separate lines so `rate × hours = amount` stays true visually.
  // Keying on is_overhead also keeps a worker who is also the overhead
  // employee from collapsing their real labor into the overhead row.
  const map = new Map<string, LaborRow>();
  for (const r of rows) {
    const oh = !!r.is_overhead;
    const rateNum = parseFloat(String(r.rate).replace(/[$,]/g, '')) || 0;
    const key = `${r.employee_name}|${r.tier_label}|${rateNum.toFixed(2)}|${oh ? 'oh' : 'l'}`;
    const amt = parseFloat(String(r.amount).replace(/[$,]/g, '')) || 0;
    const cur = map.get(key);
    if (cur) {
      cur.hours += Number(r.hours || 0);
      const curAmt = parseFloat(String(cur.amount).replace(/[$,]/g, '')) || 0;
      cur.amount = (curAmt + amt).toFixed(2);
    } else {
      map.set(key, { employee_name: r.employee_name, tier_label: r.tier_label, hours: Number(r.hours || 0), rate: r.rate, amount: amt.toFixed(2), is_overhead: oh });
    }
  }
  // Sort: real labor before overhead; within each, employee asc, then ST → OT → DT, then rate asc.
  const tierOrder = (t: string) => (/double/i.test(t) ? 2 : /over/i.test(t) ? 1 : 0);
  const num = (s: string) => parseFloat(String(s).replace(/[$,]/g, '')) || 0;
  return [...map.values()].sort((a, b) =>
    Number(a.is_overhead) - Number(b.is_overhead)
    || a.employee_name.localeCompare(b.employee_name)
    || tierOrder(a.tier_label) - tierOrder(b.tier_label)
    || num(a.rate) - num(b.rate),
  );
}
// Render any monetary input (already-formatted "$1,234.56" or a raw number
// like "1234.56") as "1,234.56" with thousands separators. aggregateLabor
// emits raw .toFixed(2) strings without commas, so we always reparse and
// reformat here rather than just stripping the leading dollar.
const NUM_FMT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function stripDollar(v: string | number | undefined): string {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''));
  if (!isFinite(n)) return '';
  return NUM_FMT.format(n);
}
function laborHoursTotal(labor: any[]): number {
  return labor.reduce((a, l) => a + Number(l.hours || 0), 0);
}
function expenseTotalIncludingMarkup(byCat: Map<string, any>, markup: any[]): number {
  const cats = [...byCat.values()].reduce((a, c) => a + c.amount, 0);
  const mk = markup.reduce((a, m) => a + (parseFloat(String(m.amount).replace(/[$,]/g, '')) || 0), 0);
  return cats + mk;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 2 — Employee Hours pivot
// ─────────────────────────────────────────────────────────────────────────────
function EmployeeHoursPage({ d }: { d: PackageData }) {
  // The overhead employee appears as a synthetic row with its calc hours
  // landing under ST (per design — overhead is dollars-driven, not real time).
  // Label distinguishes it from any real-labor row the same employee may have
  // on this invoice (e.g., the foreman is overhead AND worked real ST hours).
  const rows = d.overhead
    ? [...d.employeeHours, { employeeName: d.overhead.employeeName, st: d.overhead.hours, ot: 0, dt: 0 }]
    : d.employeeHours;
  const totals = rows.reduce(
    (a, r) => ({ st: a.st + r.st, ot: a.ot + r.ot, dt: a.dt + r.dt }),
    { st: 0, ot: 0, dt: 0 },
  );

  return (
    <Page size="LETTER" style={s.page}>
      <Text style={{ fontFamily: 'Helvetica-Bold' }}>Employee Hours</Text>
      <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 8 }}>Job Billing # {d.billedReference}</Text>

      <View style={{ width: 330 }}>
        <View style={[{ flexDirection: 'row' }, s.excelHeader]}>
          <Text style={{ width: 130 }}> </Text>
          <Text style={{ width: 65, textAlign: 'right' }}>ST Total</Text>
          <Text style={{ width: 65, textAlign: 'right' }}>OT Total</Text>
          <Text style={{ width: 70, textAlign: 'right' }}>DT Total</Text>
        </View>
        {rows.map((r) => (
          <View key={r.employeeName} style={[s.pivotRow, { padding: 3 }]}>
            <Text style={{ width: 130 }}>{r.employeeName}</Text>
            <Text style={{ width: 65, textAlign: 'right' }}>{r.st}</Text>
            <Text style={{ width: 65, textAlign: 'right' }}>{r.ot}</Text>
            <Text style={{ width: 70, textAlign: 'right' }}>{r.dt}</Text>
          </View>
        ))}
        <View style={[{ flexDirection: 'row', padding: 3, borderTopWidth: 1, borderColor: colors.line, fontFamily: 'Helvetica-Bold' }]}>
          <Text style={{ width: 130, fontFamily: 'Helvetica-Bold' }}>Grand Total</Text>
          <Text style={{ width: 65, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{totals.st}</Text>
          <Text style={{ width: 65, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{totals.ot}</Text>
          <Text style={{ width: 70, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{totals.dt}</Text>
        </View>
      </View>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 3 — General Hours Entry (landscape weekly grid)
// ─────────────────────────────────────────────────────────────────────────────
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIER_SUFFIX = ['1X', '1.5X', '2X'];

function WeeklyGridPage({ d }: { d: PackageData }) {
  // Group rows: jobCode → billedRef → weekStart (Mon) → employeeName → aggregated
  // weekly bucket. Each bucket holds the 7 day-of-week hour values (by tier)
  // plus that employee's week-total labor $.
  type DayBucket = { st: number; ot: number; dt: number };
  type EmpWeek = { byDow: Map<number, DayBucket>; laborAmount: number; st: number; ot: number; dt: number };
  const newEmpWeek = (): EmpWeek => ({ byDow: new Map(), laborAmount: 0, st: 0, ot: 0, dt: 0 });
  const mondayOf = (yyyymmdd: string): string => {
    const dt = new Date(yyyymmdd + 'T00:00:00Z');
    const dow = (dt.getUTCDay() + 6) % 7; // Mon = 0
    dt.setUTCDate(dt.getUTCDate() - dow);
    return dt.toISOString().slice(0, 10);
  };
  const byJob = new Map<string, Map<string, Map<string, Map<string, EmpWeek>>>>();
  for (const r of d.dailyGrid) {
    const week = mondayOf(r.workDate);
    const j = byJob.get(r.jobCode) ?? new Map();
    const b = j.get(r.billedRef) ?? new Map();
    const w = b.get(week) ?? new Map();
    const emp = w.get(r.employeeName) ?? newEmpWeek();
    const day = emp.byDow.get(r.dow) ?? { st: 0, ot: 0, dt: 0 };
    day.st += r.st;
    day.ot += r.ot;
    day.dt += r.dt;
    emp.byDow.set(r.dow, day);
    emp.st += r.st;
    emp.ot += r.ot;
    emp.dt += r.dt;
    emp.laborAmount += r.laborAmount;
    w.set(r.employeeName, emp);
    b.set(week, w);
    j.set(r.billedRef, b);
    byJob.set(r.jobCode, j);
  }

  const labelW = 95;
  const totalW = 55;
  const cellW = 22;
  const dayW = cellW * 3; // 3 sub-cols per day
  const summaryW = 32;

  // Currency column is labeled "Total Labor $" — drop the $ sign on values for compactness.
  function dollarFor(n: number): string {
    return n ? formatMoney(n).replace('$', '') : '';
  }

  // Empty cell — landscape page is wide enough for all 21 day/tier cells.
  const empty = (key: string) => (
    <Text key={key} style={{ width: cellW, textAlign: 'right', borderRightWidth: 0.5, borderColor: colors.thinLine, padding: 1 }}> </Text>
  );
  const cell = (key: string, n: number) => (
    <Text key={key} style={{ width: cellW, textAlign: 'right', borderRightWidth: 0.5, borderColor: colors.thinLine, padding: 1 }}>
      {n ? n.toFixed(n % 1 ? 2 : 0) : ' '}
    </Text>
  );

  return (
    <Page size="LETTER" orientation="landscape" style={s.pageLandscape}>
      <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 6 }}>General Hours Entry Form</Text>

      {/* Header row 1 — day names */}
      <View style={{ flexDirection: 'row', backgroundColor: colors.excelHeader }}>
        <Text style={{ width: labelW, padding: 2, color: colors.excelHeaderText }}> </Text>
        <Text style={{ width: totalW, padding: 2, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold', textAlign: 'right', borderRightWidth: 1, borderColor: colors.line }}>Total Labor $</Text>
        {DAY_NAMES.map((dn) => (
          <Text key={dn} style={{ width: dayW, padding: 2, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold', textAlign: 'center', borderLeftWidth: 1, borderColor: '#fff' }}>{dn}</Text>
        ))}
        <Text style={{ width: summaryW, padding: 2, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold', textAlign: 'center', borderLeftWidth: 1, borderColor: '#fff' }}>ST</Text>
        <Text style={{ width: summaryW, padding: 2, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>1.5X</Text>
        <Text style={{ width: summaryW, padding: 2, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>2X</Text>
        <Text style={{ width: summaryW, padding: 2, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>Total</Text>
      </View>

      {/* Header row 2 — tier columns under each day */}
      <View style={{ flexDirection: 'row', backgroundColor: colors.excelHeader, color: colors.excelHeaderText }}>
        <Text style={{ width: labelW, padding: 2 }}> </Text>
        <Text style={{ width: totalW, padding: 2, borderRightWidth: 1, borderColor: colors.line }}> </Text>
        {DAY_NAMES.flatMap((_, di) =>
          TIER_SUFFIX.map((t, ti) => (
            <Text key={`${di}-${ti}`} style={{ width: cellW, paddingVertical: 2, paddingHorizontal: 1, fontSize: 7, color: colors.excelHeaderText, textAlign: 'center' }}>{t}</Text>
          )),
        )}
        <Text style={{ width: summaryW, padding: 2, fontSize: 7, color: colors.excelHeaderText, textAlign: 'center' }}>Hours</Text>
        <Text style={{ width: summaryW, padding: 2, fontSize: 7, color: colors.excelHeaderText, textAlign: 'center' }}>Hours</Text>
        <Text style={{ width: summaryW, padding: 2, fontSize: 7, color: colors.excelHeaderText, textAlign: 'center' }}>Hours</Text>
        <Text style={{ width: summaryW, padding: 2, fontSize: 7, color: colors.excelHeaderText, textAlign: 'center' }}>Hours</Text>
      </View>

      {/* Body — one banner row per week (Monday-anchored), then one row per
          employee in that week showing the full Mon→Sun hours across the 21
          day/tier cells. Aggregated across the week, so a single employee
          working 5 days shows up as one row, not five. */}
      {[...byJob.entries()].map(([jobCode, byBilled]) => (
        <View key={jobCode}>
          {[...byBilled.entries()].map(([billed, byWeek]) => (
            <View key={billed}>
              <View style={[s.excelBand, { flexDirection: 'row' }]}>
                <Text style={{ width: labelW, padding: 2 }}>{billed}</Text>
                <View style={{ flex: 1 }} />
              </View>
              {[...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, byEmp]) => {
                // Aggregate the week's totals across every employee: per-day
                // (Mon..Sun × ST/OT/DT) so the cells in the totals row show
                // sums, plus the right-hand ST/OT/DT/Total summary columns
                // and the Total Labor $ column.
                const wkTotals = { st: 0, ot: 0, dt: 0, dollar: 0 };
                const wkByDow = new Map<number, DayBucket>();
                for (const emp of byEmp.values()) {
                  wkTotals.st += emp.st;
                  wkTotals.ot += emp.ot;
                  wkTotals.dt += emp.dt;
                  wkTotals.dollar += emp.laborAmount;
                  for (const [dow, day] of emp.byDow.entries()) {
                    const cur = wkByDow.get(dow) ?? { st: 0, ot: 0, dt: 0 };
                    cur.st += day.st;
                    cur.ot += day.ot;
                    cur.dt += day.dt;
                    wkByDow.set(dow, cur);
                  }
                }
                return (
                  <View key={week}>
                    <View style={{ flexDirection: 'row', borderBottomWidth: 0.25, borderColor: colors.thinLine, backgroundColor: colors.excelBand }}>
                      <Text style={{ width: labelW, padding: 1, paddingLeft: 8, fontFamily: 'Helvetica-Bold' }}>Week of {week}</Text>
                      <Text style={{ width: totalW, padding: 1, textAlign: 'right', borderRightWidth: 1, borderColor: colors.line }}> </Text>
                      {Array.from({ length: 21 }).map((_, idx) => empty(`wk-empty-${week}-${idx}`))}
                      <Text style={{ width: summaryW, padding: 1 }}> </Text>
                      <Text style={{ width: summaryW, padding: 1 }}> </Text>
                      <Text style={{ width: summaryW, padding: 1 }}> </Text>
                      <Text style={{ width: summaryW, padding: 1 }}> </Text>
                    </View>
                    {[...byEmp.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([empName, emp]) => (
                      <View key={empName + week} style={{ flexDirection: 'row', borderBottomWidth: 0.25, borderColor: colors.thinLine }}>
                        <Text style={{ width: labelW, padding: 1, paddingLeft: 16 }}>{empName}</Text>
                        <Text style={{ width: totalW, padding: 1, textAlign: 'right', borderRightWidth: 1, borderColor: colors.line }}>{dollarFor(emp.laborAmount) || ' '}</Text>
                        {Array.from({ length: 21 }).map((_, idx) => {
                          const dayIdx = Math.floor(idx / 3);
                          const tierIdx = idx % 3;
                          const day = emp.byDow.get(dayIdx);
                          if (!day) return empty(`emp-empty-${empName}-${week}-${idx}`);
                          const val = tierIdx === 0 ? day.st : tierIdx === 1 ? day.ot : day.dt;
                          return cell(`emp-cell-${empName}-${week}-${idx}`, val);
                        })}
                        <Text style={{ width: summaryW, padding: 1, textAlign: 'right' }}>{emp.st || ' '}</Text>
                        <Text style={{ width: summaryW, padding: 1, textAlign: 'right' }}>{emp.ot || ' '}</Text>
                        <Text style={{ width: summaryW, padding: 1, textAlign: 'right' }}>{emp.dt || ' '}</Text>
                        <Text style={{ width: summaryW, padding: 1, textAlign: 'right' }}>{emp.st + emp.ot + emp.dt || ' '}</Text>
                      </View>
                    ))}
                    {/* Week subtotal — sums across all employees in this week */}
                    <View style={{ flexDirection: 'row', borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: colors.line, backgroundColor: colors.excelSubtotal }}>
                      <Text style={{ width: labelW, padding: 1, paddingLeft: 16, fontFamily: 'Helvetica-Bold' }}>Week total</Text>
                      <Text style={{ width: totalW, padding: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold', borderRightWidth: 1, borderColor: colors.line }}>{dollarFor(wkTotals.dollar) || ' '}</Text>
                      {Array.from({ length: 21 }).map((_, idx) => {
                        const dayIdx = Math.floor(idx / 3);
                        const tierIdx = idx % 3;
                        const day = wkByDow.get(dayIdx);
                        if (!day) return empty(`wk-tot-empty-${week}-${idx}`);
                        const val = tierIdx === 0 ? day.st : tierIdx === 1 ? day.ot : day.dt;
                        return cell(`wk-tot-${week}-${idx}`, val);
                      })}
                      <Text style={{ width: summaryW, padding: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{wkTotals.st || ' '}</Text>
                      <Text style={{ width: summaryW, padding: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{wkTotals.ot || ' '}</Text>
                      <Text style={{ width: summaryW, padding: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{wkTotals.dt || ' '}</Text>
                      <Text style={{ width: summaryW, padding: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{(wkTotals.st + wkTotals.ot + wkTotals.dt) || ' '}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ))}

      {/* Overhead line — rendered above the Grand Total so the dollars in the
          "Total Labor $" column visibly sum to the Grand Total. Overhead has
          no date so its day/tier cells stay blank; only the dollar column
          carries a value. */}
      {d.overhead && d.overhead.amount > 0 ? (
        <View style={{ flexDirection: 'row', borderBottomWidth: 0.25, borderColor: colors.thinLine }}>
          <Text style={{ width: labelW, padding: 1, paddingLeft: 8, fontStyle: 'italic' }}>{d.overhead.employeeName}</Text>
          <Text style={{ width: totalW, padding: 1, textAlign: 'right', borderRightWidth: 1, borderColor: colors.line }}>{dollarFor(d.overhead.amount) || ' '}</Text>
          {Array.from({ length: 21 }).map((_, idx) => empty(`oh-empty-${idx}`))}
          <Text style={{ width: summaryW, padding: 1 }}> </Text>
          <Text style={{ width: summaryW, padding: 1 }}> </Text>
          <Text style={{ width: summaryW, padding: 1 }}> </Text>
          <Text style={{ width: summaryW, padding: 1 }}> </Text>
        </View>
      ) : null}

      {/* Grand total */}
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: colors.line, paddingTop: 2 }}>
        {(() => {
          // Roll up totals across the full period: right-side tier totals,
          // dollars, AND per-day (Mon..Sun × ST/OT/DT) sums so the day-of-week
          // cells in the Grand Total row carry real numbers — same level of
          // detail the Week total subtotal rows show.
          const grandByDow = new Map<number, DayBucket>();
          const base = d.dailyGrid.reduce(
            (a, r) => {
              const day = grandByDow.get(r.dow) ?? { st: 0, ot: 0, dt: 0 };
              day.st += r.st;
              day.ot += r.ot;
              day.dt += r.dt;
              grandByDow.set(r.dow, day);
              return { st: a.st + r.st, ot: a.ot + r.ot, dt: a.dt + r.dt, dollar: a.dollar + r.laborAmount };
            },
            { st: 0, ot: 0, dt: 0, dollar: 0 },
          );
          // Overhead has no date so it doesn't appear in any daily row, but its
          // dollars roll into the Grand Total Labor $ so it ties to Page 1.
          // The overhead row above renders the same amount in the column so
          // the visible row dollars sum to this Grand Total.
          const t = { ...base, dollar: base.dollar + (d.overhead?.amount ?? 0) };
          return (
            <>
              <Text style={{ width: labelW, padding: 2, fontFamily: 'Helvetica-Bold' }}>Grand Total</Text>
              <Text style={{ width: totalW, padding: 2, textAlign: 'right', fontFamily: 'Helvetica-Bold', borderRightWidth: 1, borderColor: colors.line }}>{dollarFor(t.dollar) || ' '}</Text>
              {Array.from({ length: 21 }).map((_, idx) => {
                const dayIdx = Math.floor(idx / 3);
                const tierIdx = idx % 3;
                const day = grandByDow.get(dayIdx);
                if (!day) return empty(`g-empty-${idx}`);
                const val = tierIdx === 0 ? day.st : tierIdx === 1 ? day.ot : day.dt;
                return cell(`g-${idx}`, val);
              })}
              <Text style={{ width: summaryW, padding: 2, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{t.st || ' '}</Text>
              <Text style={{ width: summaryW, padding: 2, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{t.ot || ' '}</Text>
              <Text style={{ width: summaryW, padding: 2, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{t.dt || ' '}</Text>
              <Text style={{ width: summaryW, padding: 2, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{(t.st + t.ot + t.dt) || ' '}</Text>
            </>
          );
        })()}
      </View>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 4 — Expense Log
// Grouped Category → Vendor → expense rows, with category and vendor subtotals.
// The row order here drives the order receipts are merged at the back of the
// package, so a reviewer can read top-to-bottom on this page and turn each
// page of receipts to match.
// ─────────────────────────────────────────────────────────────────────────────
function ExpenseLogPage({ d }: { d: PackageData }) {
  // colW: Date | Vendor | Reference | Description | Amount (right)
  const W = { date: 70, vendor: 140, reference: 110, description: 130, amount: 70 };
  const totalW = W.date + W.vendor + W.reference + W.description + W.amount;
  const fmt = (n: number) => formatMoney(n).replace('$', '');

  // Group: category → vendor → rows (rows already in canonical order from data layer)
  type VendorGroup = { vendor: string; rows: typeof d.expenseLog; subtotal: number };
  type CatGroup = { category: string; label: string; vendors: VendorGroup[]; subtotal: number };
  const catMap = new Map<string, CatGroup>();
  for (const r of d.expenseLog) {
    const label = EXPENSE_CATEGORY_LABELS[r.category as ExpenseCategory] ?? r.category;
    const cg = catMap.get(r.category) ?? { category: r.category, label, vendors: [], subtotal: 0 };
    cg.subtotal += r.amount;
    let vg = cg.vendors[cg.vendors.length - 1];
    if (!vg || vg.vendor !== r.vendor) {
      vg = { vendor: r.vendor || '(no vendor)', rows: [], subtotal: 0 };
      cg.vendors.push(vg);
    }
    vg.rows.push(r);
    vg.subtotal += r.amount;
    catMap.set(r.category, cg);
  }
  const groups = [...catMap.values()];
  const grand = d.expenseLog.reduce((a, r) => a + r.amount, 0);

  return (
    <Page size="LETTER" style={s.page}>
      <Text style={{ fontFamily: 'Helvetica-Bold' }}>Expense Log</Text>
      <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 8 }}>Job Billing # {d.billedReference}</Text>

      <View style={{ width: totalW }}>
        {/* Column headers */}
        <View style={[{ flexDirection: 'row' }, s.excelHeader]}>
          <Text style={{ width: W.date, padding: 3, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold' }}>Date</Text>
          <Text style={{ width: W.vendor, padding: 3, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold' }}>Vendor</Text>
          <Text style={{ width: W.reference, padding: 3, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold' }}>Reference</Text>
          <Text style={{ width: W.description, padding: 3, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold' }}>Description</Text>
          <Text style={{ width: W.amount, padding: 3, color: colors.excelHeaderText, fontFamily: 'Helvetica-Bold', textAlign: 'right' }}>Amount</Text>
        </View>

        {groups.map((cg) => (
          <View key={cg.category} wrap={false}>
            {/* Category banner */}
            <View style={[s.excelBand, { flexDirection: 'row', marginTop: 4 }]}>
              <Text style={{ flex: 1, padding: 3, fontFamily: 'Helvetica-Bold' }}>{cg.label}</Text>
              <Text style={{ width: W.amount, padding: 3, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{fmt(cg.subtotal)}</Text>
            </View>

            {cg.vendors.map((vg, vi) => (
              <View key={`${cg.category}-${vi}`}>
                {/* Vendor sub-header (only shown if vendor groups split or there's >1 vendor in category) */}
                {(cg.vendors.length > 1 || vg.rows.length > 1) && (
                  <View style={{ flexDirection: 'row', borderBottomWidth: 0.25, borderColor: colors.thinLine }}>
                    <Text style={{ flex: 1, padding: 2, paddingLeft: 10, fontFamily: 'Helvetica-Bold' }}>{vg.vendor}</Text>
                    <Text style={{ width: W.amount, padding: 2, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{fmt(vg.subtotal)}</Text>
                  </View>
                )}
                {/* Detail rows */}
                {vg.rows.map((r) => (
                  <View key={r.expenseId} style={{ flexDirection: 'row', borderBottomWidth: 0.25, borderColor: colors.thinLine }}>
                    <Text style={{ width: W.date, padding: 2, paddingLeft: cg.vendors.length > 1 || vg.rows.length > 1 ? 18 : 10 }}>{r.workDate}</Text>
                    <Text style={{ width: W.vendor, padding: 2 }}>{r.vendor}</Text>
                    <Text style={{ width: W.reference, padding: 2 }}>{r.reference || '—'}</Text>
                    <Text style={{ width: W.description, padding: 2 }}>{r.description}</Text>
                    <Text style={{ width: W.amount, padding: 2, textAlign: 'right' }}>{fmt(r.amount)}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ))}

        {/* Grand total */}
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: colors.line, marginTop: 6 }}>
          <Text style={{ flex: 1, padding: 4, fontFamily: 'Helvetica-Bold' }}>Grand Total</Text>
          <Text style={{ width: W.amount, padding: 4, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{fmt(grand)}</Text>
        </View>
      </View>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Document
// ─────────────────────────────────────────────────────────────────────────────
export function PackageDocument({ data, totalPages }: { data: PackageData; totalPages: number }) {
  return (
    <Document>
      <ProposalPage d={data} pageCount={totalPages} />
      <EmployeeHoursPage d={data} />
      {data.dailyGrid.length > 0 && <WeeklyGridPage d={data} />}
      {data.expenseLog.length > 0 && <ExpenseLogPage d={data} />}
    </Document>
  );
}
