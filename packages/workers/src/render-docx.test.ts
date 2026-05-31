// Phase 14: render the committed example template with a fixture data object and
// assert placeholder substitution + loop expansion in the output document.xml.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { dottedParser } from './render-docx.js';

const templatePath = join(process.cwd(), 'docs', 'example-template.docx');
const d = existsSync(templatePath) ? describe : describe.skip;

d('docx template render', () => {
  const data = {
    company: { name: 'Darrow Electric', address: '100 Voltage Way', phone: '(417) 555-0100', email: 'b@d.test' },
    customer: { name: 'Acme Co', bill_to_address: '1 Main' },
    job: { code: 'D26NB048', description: 'Cooler rewire', po_number: 'PO9', billing_type_label: 'Time & Materials', site_address: '' },
    invoice: { number: 'D26NB048.01', date: '05/29/2026', through_date: '05/29/2026', notes: 'Thanks' },
    totals: { labor: '$1,100.00', materials: '$200.00', equipment_rent: '$0.00', truck_rental: '$0.00', per_diem: '$0.00', travel: '$0.00', freight: '$0.00', stock_material: '$0.00', markup: '$30.00', grand_total: '$1,330.00' },
    labor_lines: [
      { employee_name: 'Brett Howard', tier_label: 'Straight Time', hours: 8, rate: '$100.00', amount: '$800.00' },
      { employee_name: 'Brett Howard', tier_label: 'Overtime', hours: 2, rate: '$150.00', amount: '$300.00' },
    ],
    expense_lines_flat: [{ category_label: 'Materials & Parts', vendor: 'Graybar', description: 'wire', amount: '$200.00' }],
    markup_lines: [{ category_label: 'Materials & Parts', amount: '$30.00' }],
    has_materials: true,
    has_markup: true,
  };

  function render() {
    const zip = new PizZip(readFileSync(templatePath));
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, parser: dottedParser, nullGetter: () => '' });
    doc.render(data);
    return new PizZip(doc.getZip().generate({ type: 'nodebuffer' })).file('word/document.xml')!.asText();
  }

  it('substitutes scalar placeholders', () => {
    const xml = render();
    // text may be split across runs, so strip XML tags before searching
    const text = xml.replace(/<[^>]+>/g, '');
    expect(text).toContain('D26NB048.01');
    expect(text).toContain('Darrow Electric');
    expect(text).toContain('$1,330.00');
  });

  it('expands the labor loop to one line per tier', () => {
    const text = render().replace(/<[^>]+>/g, '');
    expect(text).toContain('Straight Time');
    expect(text).toContain('Overtime');
    expect(text).toContain('Graybar');
  });
});
