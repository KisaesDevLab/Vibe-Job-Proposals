// Generates a small synthetic Time_Allocation_Tracking.xlsm-style workbook that
// mirrors the documented sheet layout (Phase 18), since the real workbook is not
// in the repo. Run: npx tsx packages/db/test/fixtures/make-fixture.ts [outPath]
import ExcelJS from 'exceljs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function makeFixture(outPath: string): Promise<string> {
  const wb = new ExcelJS.Workbook();

  // --- Companies (code, name) ---
  const companies = wb.addWorksheet('Companies');
  companies.addRow(['Code', 'Name']);
  [
    ['J', 'Jasper Products'],
    ['B', 'Bagcraft'],
    ['NB', 'Nutra Blend'],
    ['SC', 'Sugar Creek'],
    ['D', 'Diamond Pet Foods'],
    ['G', 'Graham Packaging'],
    ['EP', 'Eagle Picher'],
    ['DS', 'Darlington'],
  ].forEach((r) => companies.addRow(r));

  // --- Employee Active (name, level) ---
  const emp = wb.addWorksheet('Employee Active');
  emp.addRow(['Name', 'Level']);
  [
    ['Brett Howard', 'Foreman'],
    ['Carla Reyes', 'Journeyman'],
    ['Dan Ortiz', '3'],
  ].forEach((r) => emp.addRow(r));

  // --- Defaults (customer, level, bill 1x/1.5x/2x) ---
  const defaults = wb.addWorksheet('Defaults');
  defaults.addRow(['Customer', 'Level', 'Rate1x', 'Rate15x', 'Rate2x']);
  const defRows: any[] = [];
  const billByCust: Record<string, number> = { 'Nutra Blend': 95, Bagcraft: 90, 'Diamond Pet Foods': 100 };
  for (const [cust, base] of Object.entries(billByCust)) {
    for (const lvl of ['Foreman', 'Journeyman', 'Apprentice Yr 3']) {
      const bump = lvl === 'Foreman' ? 20 : lvl === 'Journeyman' ? 0 : -25;
      defRows.push([cust, lvl, base + bump, (base + bump) * 1.5, (base + bump) * 2]);
    }
  }
  // Sugar Creek flat $110 regardless of level
  for (const lvl of ['Foreman', 'Journeyman', 'Apprentice Yr 3']) defRows.push(['Sugar Creek', lvl, 110, 110, 110]);
  defRows.forEach((r) => defaults.addRow(r));

  // --- Job Codes (code, description, T/M Quote) ---
  const jc = wb.addWorksheet('Job Codes');
  jc.addRow(['Code', 'Description', 'T/M Quote']);
  [
    ['D24NB001', 'Cooler rewire', 'T/M'],
    ['D24B001', 'Compressor #7', 'T/M'],
    ['D24D013', 'Plant lighting', 'Quote'],
    ['D24SC001', 'Panel upgrade', 'T/M'],
    ['D24MF001', 'Mystery job', 'T/M'], // unmapped customer code MF -> placeholder
  ].forEach((r) => jc.addRow(r));

  // --- Time Recap: Employee, Job, WeekAnchor(Mon), then 21 day/tier cols, Billed ---
  const tr = wb.addWorksheet('Time Recap');
  const dayCols: string[] = [];
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) for (const t of ['ST', 'OT', 'DT']) dayCols.push(`${d}_${t}`);
  tr.addRow(['Employee', 'Job', 'Date', ...dayCols, 'Billed']);
  // junk top row placeholder (skipped by importer)
  tr.addRow(['AAA', '', 0.5, ...dayCols.map(() => ''), '']);
  const z = (vals: Record<string, number>) => dayCols.map((c) => vals[c] ?? 0);
  // Brett on D24NB001 week of 2024-01-08 (Mon): Mon 8ST 2OT, Tue 8ST -> billed D24NB001.01
  tr.addRow(['Brett Howard', 'D24NB001', new Date(Date.UTC(2024, 0, 8)), ...z({ Mon_ST: 8, Mon_OT: 2, Tue_ST: 8 }), 'D24NB001.01']);
  // Carla on D24B001 week of 2024-01-08: Mon 8ST, Wed 8ST -> billed D24B001.01
  tr.addRow(['Carla Reyes', 'D24B001', new Date(Date.UTC(2024, 0, 8)), ...z({ Mon_ST: 8, Wed_ST: 8 }), 'D24B001.01']);
  // Dan on D24SC001 week of 2024-01-15: Mon 8ST -> unbilled
  tr.addRow(['Dan Ortiz', 'D24SC001', new Date(Date.UTC(2024, 0, 15)), ...z({ Mon_ST: 8 }), '']);

  // --- Billed (reference, job) with an intentional duplicate ---
  const billed = wb.addWorksheet('Billed');
  billed.addRow(['Billed', 'Job']);
  [
    ['D24NB001.01', 'D24NB001'],
    ['D24B001.01', 'D24B001'],
    ['D24B001.01', 'D24B001'], // exact duplicate -> deduped
  ].forEach((r) => billed.addRow(r));

  // --- Import From AW (Date, Description, Reference, Amount, Account, Job) ---
  const aw = wb.addWorksheet('Import From AW');
  aw.addRow(['Date', 'Description', 'Reference', 'Amount', 'Account', 'Job']);
  [
    [new Date(Date.UTC(2024, 0, 8)), 'Graybar', 'S010629890.001', -425.5, '5040 Job materials', 'D24NB001.01'],
    [new Date(Date.UTC(2024, 0, 9)), 'United Rentals', 'UR-88', -300, '6250 Equipment rental', 'D24B001'],
    [new Date(Date.UTC(2024, 0, 10)), 'Daily Sales junk', 'X', -50, '5040 Job materials', 'D24D900'], // daily-sales-ish, kept (no Daily Sales cust here)
    [new Date(Date.UTC(2024, 0, 11)), 'No job row', '', -10, '5040 Job materials', ''], // blank job -> skipped
  ].forEach((r) => aw.addRow(r));

  await wb.xlsx.writeFile(outPath);
  return outPath;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? join(__dirname, 'Time_Allocation_Tracking.xlsx');
  makeFixture(out).then((p) => console.log(`wrote fixture ${p}`));
}
