// Demo data for poking the UI. Idempotent — re-running is safe.
// Run: node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-demo.ts
import {
  db,
  sql,
  settings,
  customers,
  rateLevels,
  employees,
  employeeCostRates,
  rateSchedules,
  rateScheduleLines,
  jobs,
  timeEntries,
  expenses,
} from '@darrow/db';
import { eq, and, sql as dsql } from 'drizzle-orm';

if (process.env.NODE_ENV === 'production') {
  console.error('[seed-demo] refusing to run in production');
  process.exit(1);
}

function mondayOfThisWeek(d = new Date()): string {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = x.getUTCDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  x.setUTCDate(x.getUTCDate() + offset);
  return x.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const x = new Date(iso + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

async function main() {
  // 1) Company settings
  await db.update(settings).set({
    companyName: 'Darrow Electric',
    addressLine1: '123 Main Street',
    city: 'Springfield',
    state: 'MO',
    zip: '65802',
    phone: '(417) 555-0100',
    email: 'office@darrow-electric.example',
  }).where(eq(settings.id, 1));
  console.log('[seed-demo] settings updated');

  // 2) Customer addresses + one markup override
  const fillCustomer = async (name: string, addr: Partial<typeof customers.$inferInsert>) => {
    await db.update(customers).set(addr).where(eq(customers.name, name));
  };
  await fillCustomer('Jasper Products', {
    billToAddress1: '500 Industrial Park Dr',
    billToCity: 'Joplin', billToState: 'MO', billToZip: '64801',
    contactName: 'Pat Buyer', contactEmail: 'ap@jasper.example', contactPhone: '(417) 555-0111',
  });
  await fillCustomer('Bagcraft', {
    billToAddress1: '200 Packaging Way',
    billToCity: 'Baxter Springs', billToState: 'KS', billToZip: '66713',
    contactName: 'Sam Receiver', contactEmail: 'ap@bagcraft.example', contactPhone: '(620) 555-0122',
  });
  await fillCustomer('Nutra Blend', {
    billToAddress1: '900 Feed Mill Rd',
    billToCity: 'Neosho', billToState: 'MO', billToZip: '64850',
    contactName: 'Jordan Plant', contactEmail: 'ap@nutrablend.example', contactPhone: '(417) 555-0133',
  });

  // Look these three up by name to use their ids.
  const allCustomers = await db.select().from(customers);
  const cByName = Object.fromEntries(allCustomers.map((c) => [c.name, c]));
  const jasper = cByName['Jasper Products']!;
  const bagcraft = cByName['Bagcraft']!;
  const nutra = cByName['Nutra Blend']!;
  console.log('[seed-demo] customer details filled (Jasper, Bagcraft, Nutra)');

  // 3) Rate levels — already seeded by migrations. Grab them.
  const levels = await db.select().from(rateLevels).where(eq(rateLevels.active, true));
  const lByName = Object.fromEntries(levels.map((l) => [l.name, l]));
  const foreman = lByName['Foreman']!;
  const journey = lByName['Journeyman']!;
  const appr3 = lByName['Apprentice Yr 3']!;
  const appr1 = lByName['Apprentice Yr 1']!;

  // 4) Employees with cost rates
  type EmpSpec = { name: string; levelId: string; costSt: string; costOt: string; costDt: string };
  const empSpecs: EmpSpec[] = [
    { name: 'Brett Howard',  levelId: foreman.id, costSt: '52.00', costOt: '78.00', costDt: '104.00' },
    { name: 'Jordan Ellis',  levelId: journey.id, costSt: '44.00', costOt: '66.00', costDt: '88.00' },
    { name: 'Avery Park',    levelId: appr3.id,   costSt: '32.00', costOt: '48.00', costDt: '64.00' },
    { name: 'Riley Quinn',   levelId: appr1.id,   costSt: '24.00', costOt: '36.00', costDt: '48.00' },
  ];
  const empMap: Record<string, string> = {};
  for (const e of empSpecs) {
    const existing = await db.select().from(employees).where(eq(employees.name, e.name)).limit(1);
    let id: string;
    if (existing.length) {
      id = existing[0].id;
    } else {
      const [row] = await db.insert(employees).values({ name: e.name, levelId: e.levelId, hireDate: '2024-01-15' }).returning();
      id = row.id;
    }
    empMap[e.name] = id;
    const haveRate = await db.select().from(employeeCostRates).where(eq(employeeCostRates.employeeId, id)).limit(1);
    if (!haveRate.length) {
      await db.insert(employeeCostRates).values({
        employeeId: id, effectiveFrom: '2024-01-01',
        costSt: e.costSt, costOt: e.costOt, costDt: e.costDt,
      });
    }
  }
  console.log(`[seed-demo] employees ensured (${empSpecs.length})`);

  // 5) One open-ended rate schedule per in-use customer, with a line for every active level
  const schedSpecs = [
    { customer: jasper,   name: 'Standard Rates', bills: { foreman: ['95','142.50','190'], journey: ['80','120','160'], appr3: ['62','93','124'], appr1: ['48','72','96'] } },
    { customer: bagcraft, name: 'Standard Rates', bills: { foreman: ['98','147','196'], journey: ['83','124.50','166'], appr3: ['65','97.50','130'], appr1: ['50','75','100'] } },
    { customer: nutra,    name: 'Flat Mill Rate', bills: { foreman: ['110','110','110'], journey: ['110','110','110'], appr3: ['110','110','110'], appr1: ['110','110','110'] } },
  ];
  const schedMap: Record<string, string> = {};
  for (const s of schedSpecs) {
    const existing = await db.select().from(rateSchedules).where(and(eq(rateSchedules.customerId, s.customer.id), eq(rateSchedules.name, s.name))).limit(1);
    let scheduleId: string;
    if (existing.length) {
      scheduleId = existing[0].id;
    } else {
      const [row] = await db.insert(rateSchedules).values({
        customerId: s.customer.id, name: s.name,
        effectiveFrom: '2024-01-01', effectiveTo: null,
      }).returning();
      scheduleId = row.id;
    }
    schedMap[s.customer.name] = scheduleId;
    // Lines for the 4 levels we use. Fill the remaining active levels with the journey rate so any employee placed on this customer has a line.
    const lineSpec: Array<{ levelId: string; rates: string[] }> = [
      { levelId: foreman.id, rates: s.bills.foreman },
      { levelId: journey.id, rates: s.bills.journey },
      { levelId: appr3.id,   rates: s.bills.appr3 },
      { levelId: appr1.id,   rates: s.bills.appr1 },
    ];
    // Backfill remaining active levels (Apprentice Yr 2, 4..7) with journey rate as a sane default
    for (const lvl of levels) {
      if (lineSpec.some((x) => x.levelId === lvl.id)) continue;
      lineSpec.push({ levelId: lvl.id, rates: s.bills.journey });
    }
    for (const ln of lineSpec) {
      await db.insert(rateScheduleLines).values({
        scheduleId, levelId: ln.levelId,
        rate1x: ln.rates[0], rate15x: ln.rates[1], rate2x: ln.rates[2],
      }).onConflictDoNothing();
    }
    await db.update(customers).set({ defaultRateScheduleId: scheduleId }).where(eq(customers.id, s.customer.id));
  }
  console.log('[seed-demo] rate schedules ensured (Jasper, Bagcraft, Nutra)');

  // 6) Jobs — six across the three customers
  type JobSpec = { code: string; customer: typeof jasper; description: string; billingType: 'tm' | 'quote'; po?: string };
  const jobSpecs: JobSpec[] = [
    { code: 'D26J001', customer: jasper,   description: 'Line 4 motor replacement',     billingType: 'tm' },
    { code: 'D26J002', customer: jasper,   description: 'Annual switchgear inspection', billingType: 'quote', po: 'PO-2026-441' },
    { code: 'D26B001', customer: bagcraft, description: 'Conveyor controls upgrade',    billingType: 'tm' },
    { code: 'D26B002', customer: bagcraft, description: 'Lighting retrofit – Bay 3',     billingType: 'quote', po: 'BAG-PO-118' },
    { code: 'D26NB001', customer: nutra,   description: 'Feed mill PLC commissioning',   billingType: 'tm' },
    { code: 'D26NB002', customer: nutra,   description: 'Dust collector wiring',         billingType: 'tm' },
  ];
  const jobMap: Record<string, string> = {};
  for (const j of jobSpecs) {
    const existing = await db.select().from(jobs).where(eq(jobs.code, j.code)).limit(1);
    if (existing.length) { jobMap[j.code] = existing[0].id; continue; }
    const [row] = await db.insert(jobs).values({
      code: j.code, customerId: j.customer.id, description: j.description,
      billingType: j.billingType, poNumber: j.po ?? null,
    }).returning();
    jobMap[j.code] = row.id;
  }
  console.log(`[seed-demo] jobs ensured (${jobSpecs.length})`);

  // 7) Time entries — Mon–Fri of the current week
  const monday = mondayOfThisWeek();
  console.log(`[seed-demo] week-start: ${monday}`);
  type TE = { emp: string; job: string; day: number; st: string; ot?: string; dt?: string };
  const grid: TE[] = [
    { emp: 'Brett Howard', job: 'D26J001', day: 0, st: '8' },
    { emp: 'Brett Howard', job: 'D26J001', day: 1, st: '8', ot: '2' },
    { emp: 'Brett Howard', job: 'D26J001', day: 2, st: '8' },
    { emp: 'Brett Howard', job: 'D26B001', day: 3, st: '8' },
    { emp: 'Brett Howard', job: 'D26B001', day: 4, st: '6' },

    { emp: 'Jordan Ellis', job: 'D26J001', day: 0, st: '8' },
    { emp: 'Jordan Ellis', job: 'D26J001', day: 1, st: '8' },
    { emp: 'Jordan Ellis', job: 'D26B001', day: 2, st: '8', ot: '1' },
    { emp: 'Jordan Ellis', job: 'D26B001', day: 3, st: '8' },
    { emp: 'Jordan Ellis', job: 'D26NB001', day: 4, st: '8' },

    { emp: 'Avery Park',   job: 'D26J002', day: 0, st: '4' },
    { emp: 'Avery Park',   job: 'D26B002', day: 1, st: '8' },
    { emp: 'Avery Park',   job: 'D26B002', day: 2, st: '8' },
    { emp: 'Avery Park',   job: 'D26NB001', day: 3, st: '8' },
    { emp: 'Avery Park',   job: 'D26NB002', day: 4, st: '8' },

    { emp: 'Riley Quinn',  job: 'D26NB001', day: 0, st: '8' },
    { emp: 'Riley Quinn',  job: 'D26NB001', day: 1, st: '8' },
    { emp: 'Riley Quinn',  job: 'D26NB002', day: 2, st: '8' },
    { emp: 'Riley Quinn',  job: 'D26NB002', day: 3, st: '8' },
    { emp: 'Riley Quinn',  job: 'D26B002', day: 4, st: '8' },
  ];
  let teInserted = 0;
  for (const t of grid) {
    const workDate = addDays(monday, t.day);
    await db.insert(timeEntries).values({
      employeeId: empMap[t.emp], jobId: jobMap[t.job], workDate,
      stHours: t.st, otHours: t.ot ?? '0', dtHours: t.dt ?? '0',
    }).onConflictDoUpdate({
      target: [timeEntries.employeeId, timeEntries.jobId, timeEntries.workDate],
      set: { stHours: t.st, otHours: t.ot ?? '0', dtHours: t.dt ?? '0', updatedAt: dsql`now()` },
    });
    teInserted++;
  }
  console.log(`[seed-demo] time entries upserted (${teInserted})`);

  // 8) Expenses — mix of categories, all unbilled, no attachments yet
  type ExSpec = { job: string; day: number; vendor: string; ref?: string; amount: string; category: 'materials' | 'equipment_rent' | 'truck_rental' | 'per_diem' | 'travel' | 'freight' | 'stock_material'; description?: string };
  const exSpecs: ExSpec[] = [
    { job: 'D26J001',  day: 0, vendor: 'Graybar',          ref: 'INV-77231', amount: '423.18', category: 'materials',     description: 'EMT, fittings, conductors' },
    { job: 'D26J001',  day: 2, vendor: 'United Rentals',   ref: 'UR-008891', amount: '275.00', category: 'equipment_rent', description: '20-ton scissor lift, 1 day' },
    { job: 'D26B001',  day: 1, vendor: 'Graybar',          ref: 'INV-77310', amount: '912.40', category: 'materials',     description: 'VFD + control wiring' },
    { job: 'D26B002',  day: 3, vendor: 'Acme Freight',     ref: 'BL-44102',  amount: '142.00', category: 'freight',       description: 'LTL fixtures from KC' },
    { job: 'D26NB001', day: 4, vendor: 'Cracker Barrel',                         amount: '38.74', category: 'per_diem',      description: 'Crew lunch' },
  ];
  let exInserted = 0;
  for (const e of exSpecs) {
    const workDate = addDays(monday, e.day);
    const dup = await db.select().from(expenses).where(and(
      eq(expenses.jobId, jobMap[e.job]),
      eq(expenses.vendor, e.vendor),
      eq(expenses.amount, e.amount),
      eq(expenses.workDate, workDate),
    )).limit(1);
    if (dup.length) continue;
    await db.insert(expenses).values({
      jobId: jobMap[e.job], workDate, vendor: e.vendor, reference: e.ref ?? null,
      amount: e.amount, category: e.category, description: e.description ?? null,
    });
    exInserted++;
  }
  console.log(`[seed-demo] expenses inserted (new: ${exInserted}, total spec: ${exSpecs.length})`);

  console.log('[seed-demo] done.');
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .then(() => process.exit(0))
  .catch((err) => { console.error('[seed-demo] failed', err); process.exit(1); });
