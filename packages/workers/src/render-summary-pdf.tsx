// render-summary-pdf worker. Builds a single-page customer-facing PDF
// mirroring the legacy Diamond Summary spreadsheet:
//   • Letterhead (company name + address)
//   • INVOICE banner
//   • From / To block
//   • Invoice Number, Date, PO #, Location of Service
//   • Description of Work
//   • Work Completed / Start / End dates
//   • One-row-per-child table: Job | Labor | Materials & Parts | Equipment Rent | (Other) | Total
//   • Total Invoice footer
//   • "Due Upon Receipt" + terms paragraph + signature block

import * as React from 'react';
import { Worker } from 'bullmq';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import { sql } from '@darrow/db';
import { formatMoney, formatDateMDY } from '@darrow/shared';
import { connection, logger, STORAGE } from './connection.js';
void React;

const colors = {
  ink: '#000',
  muted: '#555',
  line: '#000',
  thin: '#bbb',
  band: '#f0f0f0',
};

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 36, paddingHorizontal: 48, fontSize: 10, fontFamily: 'Helvetica', color: colors.ink },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  companyName: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  banner: { fontSize: 22, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginVertical: 12 },
  metaRow: { flexDirection: 'row', marginBottom: 4 },
  labelCell: { width: 130, fontFamily: 'Helvetica-Bold' },
  valueCell: { flex: 1 },
  descBlock: { borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: colors.thin, paddingVertical: 8, marginVertical: 8 },
  table: { borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line, marginTop: 8 },
  th: { padding: 4, fontFamily: 'Helvetica-Bold', textAlign: 'center', borderRightWidth: 1, borderColor: colors.line, backgroundColor: colors.band },
  td: { padding: 4, borderRightWidth: 1, borderColor: colors.line },
  thRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: colors.thin },
  total: { fontFamily: 'Helvetica-Bold', backgroundColor: colors.band },
  footer: { marginTop: 24, fontSize: 9, color: colors.muted, lineHeight: 1.4 },
  sigBlock: { marginTop: 24 },
});

interface MemberRow {
  invoice_id: string;
  job_code: string;
  labor: number;
  materials: number;
  equipment_rent: number;
  other: number;
  total: number;
}

interface SummaryData {
  billed_reference: string;
  date_mdy: string;
  customer_name: string;
  customer_address: string;
  company_name: string;
  company_address: string;
  company_phone: string;
  company_email: string;
  po_number: string;
  location: string;
  description: string;
  start_mdy: string;
  end_mdy: string;
  members: MemberRow[];
  totals: { labor: number; materials: number; equipment_rent: number; other: number; grand: number };
  show_other: boolean;
  signer_name: string;
}

function fmt(n: number): string {
  return formatMoney(n).replace('$', '');
}

function SummaryDocument({ d }: { d: SummaryData }) {
  // Column widths — without "Other", the 4 data columns share the remaining
  // space evenly; with "Other", 5 columns get slightly narrower.
  const jobW = 100;
  const dataW = d.show_other ? 80 : 95;
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        {/* Top header — company info + customer block */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.companyName}>{d.company_name}</Text>
            {d.company_address.split('\n').map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
            {d.company_phone ? <Text>{d.company_phone}</Text> : null}
          </View>
          <View>
            <Text>{d.company_email}</Text>
          </View>
        </View>

        <Text style={s.banner}>INVOICE</Text>

        <View style={s.headerRow}>
          <View style={{ width: '50%' }}>
            <View style={s.metaRow}>
              <Text style={s.labelCell}>From:</Text>
              <Text style={s.valueCell}>{d.company_name}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.labelCell}>Invoice Number:</Text>
              <Text style={s.valueCell}>{d.billed_reference}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.labelCell}>Date:</Text>
              <Text style={s.valueCell}>{d.date_mdy}</Text>
            </View>
          </View>
          <View style={{ width: '50%' }}>
            <View style={s.metaRow}>
              <Text style={s.labelCell}>To:</Text>
              <Text style={s.valueCell}>{d.customer_name}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.labelCell}>P.O. Number:</Text>
              <Text style={s.valueCell}>{d.po_number || ' '}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.labelCell}>Location of Service:</Text>
              <Text style={s.valueCell}>{d.location || ' '}</Text>
            </View>
          </View>
        </View>

        <View style={s.descBlock}>
          <View style={s.metaRow}>
            <Text style={s.labelCell}>Description of Work:</Text>
            <Text style={s.valueCell}>{d.description || ' '}</Text>
          </View>
          <View style={s.metaRow}>
            <Text style={s.labelCell}>Work Completed:</Text>
            <Text style={s.valueCell}>{d.end_mdy || ' '}</Text>
          </View>
          <View style={s.metaRow}>
            <Text style={s.labelCell}>Start:</Text>
            <Text style={{ width: 100 }}>{d.start_mdy || ' '}</Text>
            <Text style={{ width: 60, fontFamily: 'Helvetica-Bold' }}>End:</Text>
            <Text style={s.valueCell}>{d.end_mdy || ' '}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.thRow}>
            <Text style={[s.th, { width: jobW }]}>Job</Text>
            <Text style={[s.th, { width: dataW }]}>Labor</Text>
            <Text style={[s.th, { width: dataW }]}>Material and Parts</Text>
            <Text style={[s.th, { width: dataW }]}>Equipment Rent</Text>
            {d.show_other && <Text style={[s.th, { width: dataW }]}>Other</Text>}
            <Text style={[s.th, { flex: 1, borderRightWidth: 0 }]}>Total</Text>
          </View>
          {d.members.map((m) => (
            <View key={m.invoice_id} style={s.tr}>
              <Text style={[s.td, { width: jobW, fontFamily: 'Helvetica-Bold' }]}>{m.job_code}</Text>
              <Text style={[s.td, { width: dataW, textAlign: 'right' }]}>{fmt(m.labor)}</Text>
              <Text style={[s.td, { width: dataW, textAlign: 'right' }]}>{fmt(m.materials)}</Text>
              <Text style={[s.td, { width: dataW, textAlign: 'right' }]}>{fmt(m.equipment_rent)}</Text>
              {d.show_other && <Text style={[s.td, { width: dataW, textAlign: 'right' }]}>{fmt(m.other)}</Text>}
              <Text style={[s.td, { flex: 1, borderRightWidth: 0, textAlign: 'right' }]}>{fmt(m.total)}</Text>
            </View>
          ))}
          <View style={[s.tr, s.total]}>
            <Text style={[s.td, { width: jobW }]}>Total Invoice:</Text>
            <Text style={[s.td, { width: dataW, textAlign: 'right' }]}>{fmt(d.totals.labor)}</Text>
            <Text style={[s.td, { width: dataW, textAlign: 'right' }]}>{fmt(d.totals.materials)}</Text>
            <Text style={[s.td, { width: dataW, textAlign: 'right' }]}>{fmt(d.totals.equipment_rent)}</Text>
            {d.show_other && <Text style={[s.td, { width: dataW, textAlign: 'right' }]}>{fmt(d.totals.other)}</Text>}
            <Text style={[s.td, { flex: 1, borderRightWidth: 0, textAlign: 'right' }]}>{fmt(d.totals.grand)}</Text>
          </View>
        </View>

        <Text style={{ marginTop: 12, fontFamily: 'Helvetica-Bold' }}>Due Upon Receipt</Text>

        <Text style={s.footer}>
          All material is guaranteed to be as specified. The above work will be performed in accordance with the
          drawings and specifications submitted for the above work and completed in a substantial workmanlike manner.
        </Text>

        <View style={s.sigBlock}>
          <Text>Thank You,</Text>
          <Text style={{ marginTop: 18, fontFamily: 'Helvetica-Bold' }}>{d.signer_name}</Text>
        </View>
      </Page>
    </Document>
  );
}

const OTHER_CATEGORIES = ['truck_rental', 'per_diem', 'travel', 'freight', 'stock_material'] as const;

async function buildData(summaryId: string): Promise<SummaryData> {
  const [s] = await sql<any[]>`
    SELECT s.*, c.name AS customer_name,
           c.bill_to_address1, c.bill_to_address2, c.bill_to_city, c.bill_to_state, c.bill_to_zip
    FROM invoice_summaries s JOIN customers c ON c.id = s.customer_id WHERE s.id = ${summaryId}`;
  if (!s) throw new Error(`summary ${summaryId} not found`);
  const [settings] = await sql<any[]>`SELECT * FROM settings WHERE id = 1`;
  const members = await sql<any[]>`
    SELECT m.invoice_id, m.sort_order, j.code AS job_code
    FROM invoice_summary_members m
    JOIN invoices i ON i.id = m.invoice_id
    JOIN jobs j ON j.id = i.job_id
    WHERE m.summary_id = ${summaryId}
    ORDER BY m.sort_order, j.code`;

  const memberRows: MemberRow[] = [];
  let other_total = 0;
  for (const m of members) {
    const [inv] = await sql<any[]>`
      SELECT total_labor, total_materials, total_equipment_rent,
             total_truck_rental, total_per_diem, total_travel, total_freight, total_stock_material, grand_total
      FROM invoices WHERE id = ${m.invoice_id}`;
    const mkRows = await sql<{ category: string; amt: string }[]>`
      SELECT category, COALESCE(SUM(amount), 0)::numeric(14,2) AS amt
      FROM invoice_line_items WHERE invoice_id = ${m.invoice_id} AND line_type = 'expense_markup'
      GROUP BY category`;
    const mk = new Map(mkRows.map((r) => [r.category, Number(r.amt)]));
    const labor = Number(inv.total_labor) || 0;
    const materials = (Number(inv.total_materials) || 0) + (mk.get('materials') ?? 0);
    const equip = (Number(inv.total_equipment_rent) || 0) + (mk.get('equipment_rent') ?? 0);
    let other = 0;
    for (const c of OTHER_CATEGORIES) {
      other += (Number((inv as any)[`total_${c}`]) || 0) + (mk.get(c) ?? 0);
    }
    other_total += other;
    memberRows.push({
      invoice_id: m.invoice_id,
      job_code: m.job_code,
      labor,
      materials,
      equipment_rent: equip,
      other,
      total: Number(inv.grand_total) || labor + materials + equip + other,
    });
  }

  const addr = (parts: (string | null)[]) => parts.filter((p) => p && p.trim()).join('\n');
  const customer_address = addr([
    s.bill_to_address1, s.bill_to_address2,
    `${s.bill_to_city ?? ''}, ${s.bill_to_state ?? ''} ${s.bill_to_zip ?? ''}`.trim(),
  ]);
  const company_address = addr([
    settings?.address_line1, settings?.address_line2,
    `${settings?.city ?? ''}, ${settings?.state ?? ''} ${settings?.zip ?? ''}`.trim(),
  ]);

  return {
    billed_reference: s.billed_reference,
    date_mdy: formatDateMDY(s.finalized_at ? new Date(s.finalized_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)),
    customer_name: s.customer_name,
    customer_address,
    company_name: settings?.company_name ?? '',
    company_address,
    company_phone: settings?.phone ?? '',
    company_email: settings?.email ?? '',
    po_number: s.po_number ?? '',
    location: s.location_of_service ?? '',
    description: s.description ?? '',
    start_mdy: formatDateMDY(s.work_start_date),
    end_mdy: formatDateMDY(s.work_end_date),
    members: memberRows,
    totals: {
      labor: Number(s.total_labor) || 0,
      materials: Number(s.total_materials) || 0,
      equipment_rent: Number(s.total_equipment_rent) || 0,
      other: Number(s.total_other) || 0,
      grand: Number(s.grand_total) || 0,
    },
    show_other: other_total > 0,
    signer_name: settings?.company_name ?? '',
  };
}

async function render(summaryId: string): Promise<void> {
  const data = await buildData(summaryId);
  const buf = await renderToBuffer(createElement(SummaryDocument, { d: data }) as any);
  const dir = join(STORAGE, 'invoice-summaries');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const outPath = join(dir, `${summaryId}.pdf`);
  writeFileSync(outPath, buf, { mode: 0o600 });
  await sql`UPDATE invoice_summaries SET generated_pdf_path = ${outPath}, pdf_status = 'ready', pdf_error = NULL WHERE id = ${summaryId}`;
  logger.info('render-summary-pdf done', { summaryId, outPath, sizeBytes: buf.length });
}

export function startRenderSummaryPdfWorker(): Worker {
  const worker = new Worker('render-summary-pdf', async (job) => render(job.data.summaryId), { connection, concurrency: 1 });
  worker.on('failed', async (job, err) => {
    logger.error('render-summary-pdf failed', { summaryId: job?.data?.summaryId, err: String(err), attempts: job?.attemptsMade });
    try {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 2)) {
        await sql`UPDATE invoice_summaries SET pdf_status = 'failed', pdf_error = ${String(err).slice(0, 300)} WHERE id = ${job.data.summaryId}`;
      }
    } catch (dbErr) {
      logger.error('render-summary-pdf failed-handler could not persist status', { summaryId: job?.data?.summaryId, err: String(dbErr) });
    }
  });
  worker.on('error', (err) => logger.error('render-summary-pdf worker error', { err: String(err) }));
  return worker;
}
