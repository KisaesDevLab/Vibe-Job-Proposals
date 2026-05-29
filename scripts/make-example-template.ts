// Generates docs/example-template.docx — a starter invoice template with all
// supported docxtemplater placeholders, loops, and conditionals.
import PizZip from 'pizzip';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

function p(text: string, opts: { bold?: boolean; size?: number } = {}): string {
  const rpr = `${opts.bold ? '<w:b/>' : ''}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ''}`;
  // split on placeholders to preserve; docxtemplater scans text runs.
  const runs = text
    .split('\n')
    .map(
      (line, i) =>
        `<w:r><w:rPr>${rpr}</w:rPr>${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${line}</w:t></w:r>`,
    )
    .join('');
  return `<w:p><w:pPr><w:rPr>${rpr}</w:rPr></w:pPr>${runs}</w:p>`;
}

const body = [
  p('{company.name}', { bold: true, size: 32 }),
  p('{company.address}'),
  p('Phone: {company.phone}    Email: {company.email}'),
  p(''),
  p('INVOICE {invoice.number}', { bold: true, size: 28 }),
  p('Date: {invoice.date}    Through: {invoice.through_date}'),
  p(''),
  p('Bill To:', { bold: true }),
  p('{customer.name}'),
  p('{customer.bill_to_address}'),
  p(''),
  p('Job: {job.code} — {job.description}', { bold: true }),
  p('Type: {job.billing_type_label}    PO: {job.po_number}'),
  p('{job.site_address}'),
  p(''),
  p('LABOR', { bold: true }),
  p('{#labor_lines}{employee_name} – {tier_label} – {hours} hrs @ {rate} = {amount}{/labor_lines}'),
  p('Labor Total: {totals.labor}', { bold: true }),
  p(''),
  p('EXPENSES', { bold: true }),
  p('{#expense_lines_flat}{category_label} – {vendor} – {description} – {amount}{/expense_lines_flat}'),
  p('{#has_materials}Materials: {totals.materials}{/has_materials}'),
  p('{#has_equipment_rent}Equipment Rent: {totals.equipment_rent}{/has_equipment_rent}'),
  p('{#has_truck_rental}Truck Rental: {totals.truck_rental}{/has_truck_rental}'),
  p('{#has_per_diem}Per Diem: {totals.per_diem}{/has_per_diem}'),
  p('{#has_travel}Travel: {totals.travel}{/has_travel}'),
  p('{#has_freight}Freight: {totals.freight}{/has_freight}'),
  p('{#has_stock_material}Stock Material: {totals.stock_material}{/has_stock_material}'),
  p(''),
  p('{#has_markup}MARKUPS{/has_markup}', { bold: true }),
  p('{#markup_lines}{category_label} Markup = {amount}{/markup_lines}'),
  p('Total Markup: {totals.markup}'),
  p(''),
  p('GRAND TOTAL: {totals.grand_total}', { bold: true, size: 28 }),
  p(''),
  p('{invoice.notes}'),
].join('');

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

const zip = new PizZip();
zip.file(
  '[Content_Types].xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
);
zip
  .folder('_rels')!
  .file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
const word = zip.folder('word')!;
word.file('document.xml', documentXml);
word.file(
  'styles.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
);
word
  .folder('_rels')!
  .file(
    'document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
const props = zip.folder('docProps')!;
props.file(
  'core.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Darrow Invoice Template</dc:title><dc:creator>Darrow Time &amp; Invoicing</dc:creator></cp:coreProperties>`,
);
props.file(
  'app.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Darrow Time &amp; Invoicing</Application></Properties>`,
);

const out = join(process.cwd(), 'docs', 'example-template.docx');
writeFileSync(out, zip.generate({ type: 'nodebuffer' }));
// eslint-disable-next-line no-console
console.log(`wrote ${out}`);
