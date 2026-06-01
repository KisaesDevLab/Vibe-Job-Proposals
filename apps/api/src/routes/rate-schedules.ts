import { Router } from 'express';
import { ok, fail, rateScheduleSchema, rateScheduleLinesSchema } from '@darrow/shared';
import { db, rateSchedules, rateScheduleLines, rateLevels, customers } from '@darrow/db';
import { eq, desc, asc, sql } from 'drizzle-orm';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../audit.js';

export const rateSchedulesRouter = Router();

// Nested under /api/customers/:id/rate-schedules and /api/rate-schedules/:id
export const customerScheduleRouter = Router({ mergeParams: true });

customerScheduleRouter.get(
  '/',
  ah(async (req, res) => {
    const customerId = (req.params as any).id;
    const rows = await db
      .select({
        id: rateSchedules.id,
        name: rateSchedules.name,
        effectiveFrom: rateSchedules.effectiveFrom,
        effectiveTo: rateSchedules.effectiveTo,
        notes: rateSchedules.notes,
        lineCount: sql<number>`(SELECT count(*)::int FROM rate_schedule_lines WHERE schedule_id = ${rateSchedules.id})`,
      })
      .from(rateSchedules)
      .where(eq(rateSchedules.customerId, customerId))
      .orderBy(desc(rateSchedules.effectiveFrom));
    res.json(ok(rows));
  }),
);

customerScheduleRouter.post(
  '/',
  ah(async (req: AuthedRequest, res) => {
    const customerId = (req.params as any).id;
    const body = rateScheduleSchema.parse(req.body);
    try {
      const created = await db.transaction(async (tx) => {
        const [sched] = await tx
          .insert(rateSchedules)
          .values({
            customerId,
            name: body.name,
            effectiveFrom: body.effective_from,
            effectiveTo: body.effective_to ?? null,
            notes: body.notes ?? null,
          })
          .returning();
        if (body.clone_from_id) {
          const lines = await tx.select().from(rateScheduleLines).where(eq(rateScheduleLines.scheduleId, body.clone_from_id));
          for (const l of lines) {
            await tx.insert(rateScheduleLines).values({
              scheduleId: sched.id,
              levelId: l.levelId,
              rate1x: l.rate1x,
              rate15x: l.rate15x,
              rate2x: l.rate2x,
            });
          }
        }
        return sched;
      });
      await writeAudit({ userId: req.user?.id, entityType: 'rate_schedule', entityId: created.id, action: 'create', summary: `Created schedule ${created.name}` });
      res.status(201).json(ok(created));
    } catch (e: any) {
      // Postgres exclusion constraint (23P01) fires when the new schedule's
      // date range overlaps an existing one for this customer. Drizzle wraps
      // the postgres error so we check `.cause` and the message too.
      const code = e?.code ?? e?.cause?.code;
      const msg = String(e?.message ?? '') + ' ' + String(e?.cause?.message ?? '');
      if (code === '23P01' || msg.includes('no_overlap') || msg.includes('exclusion')) {
        return res.status(409).json(fail('overlap', 'Schedule dates overlap an existing schedule for this customer. Close the existing schedule (set its effective_to) before adding a new one.'));
      }
      throw e;
    }
  }),
);

// GET /api/rate-schedules — global list, used by the "Copy rates from"
// picker when creating a new schedule for a different customer. Returns
// schedules that actually have at least one line (no point copying empty
// ones). Caller-side groups by customer for the UI.
rateSchedulesRouter.get(
  '/',
  ah(async (_req, res) => {
    const rows = await db
      .select({
        id: rateSchedules.id,
        name: rateSchedules.name,
        effectiveFrom: rateSchedules.effectiveFrom,
        effectiveTo: rateSchedules.effectiveTo,
        customerId: rateSchedules.customerId,
        customerName: customers.name,
        lineCount: sql<number>`(SELECT count(*)::int FROM rate_schedule_lines WHERE schedule_id = ${rateSchedules.id})`,
      })
      .from(rateSchedules)
      .leftJoin(customers, eq(rateSchedules.customerId, customers.id))
      .orderBy(asc(customers.name), desc(rateSchedules.effectiveFrom));
    res.json(ok(rows.filter((r) => r.lineCount > 0)));
  }),
);

rateSchedulesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const [sched] = await db.select().from(rateSchedules).where(eq(rateSchedules.id, req.params.id));
    if (!sched) throw new HttpError(404, 'not_found', 'Schedule not found');
    const lines = await db
      .select({
        id: rateScheduleLines.id,
        levelId: rateScheduleLines.levelId,
        levelName: rateLevels.name,
        sortOrder: rateLevels.sortOrder,
        rate1x: rateScheduleLines.rate1x,
        rate15x: rateScheduleLines.rate15x,
        rate2x: rateScheduleLines.rate2x,
      })
      .from(rateScheduleLines)
      .leftJoin(rateLevels, eq(rateScheduleLines.levelId, rateLevels.id))
      .where(eq(rateScheduleLines.scheduleId, sched.id))
      .orderBy(asc(rateLevels.sortOrder));
    res.json(ok({ ...sched, lines }));
  }),
);

rateSchedulesRouter.put(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const body = rateScheduleSchema.partial().parse(req.body);
    // Build the set object explicitly so Drizzle only writes fields the
    // caller sent. `effective_to: null` (legitimate "open the schedule")
    // is a real value, not a skip — so keep it in the payload when the
    // key was present in the body.
    const set: Record<string, unknown> = {};
    if ('name' in body) set.name = body.name;
    if ('effective_from' in body) set.effectiveFrom = body.effective_from;
    if ('effective_to' in body) set.effectiveTo = body.effective_to ?? null;
    if ('notes' in body) set.notes = body.notes ?? null;
    try {
      const [row] = await db
        .update(rateSchedules)
        .set(set)
        .where(eq(rateSchedules.id, req.params.id))
        .returning();
      if (!row) throw new HttpError(404, 'not_found', 'Schedule not found');
      res.json(ok(row));
    } catch (e: any) {
      // Postgres exclusion constraint (23P01) fires when the new schedule's
      // date range overlaps an existing one for this customer. Drizzle wraps
      // the postgres error so we check `.cause` and the message too.
      const code = e?.code ?? e?.cause?.code;
      const msg = String(e?.message ?? '') + ' ' + String(e?.cause?.message ?? '');
      if (code === '23P01' || msg.includes('no_overlap') || msg.includes('exclusion')) {
        return res.status(409).json(fail('overlap', 'Schedule dates overlap an existing schedule for this customer. Close the existing schedule (set its effective_to) before adding a new one.'));
      }
      throw e;
    }
  }),
);

rateSchedulesRouter.post(
  '/:id/lines/bulk',
  ah(async (req: AuthedRequest, res) => {
    const lines = rateScheduleLinesSchema.parse(req.body);
    await db.transaction(async (tx) => {
      for (const l of lines) {
        await tx
          .insert(rateScheduleLines)
          .values({ scheduleId: req.params.id, levelId: l.level_id, rate1x: String(l.rate_1x), rate15x: String(l.rate_15x), rate2x: String(l.rate_2x) })
          .onConflictDoUpdate({
            target: [rateScheduleLines.scheduleId, rateScheduleLines.levelId],
            set: { rate1x: String(l.rate_1x), rate15x: String(l.rate_15x), rate2x: String(l.rate_2x) },
          });
      }
    });
    await writeAudit({ userId: req.user?.id, entityType: 'rate_schedule', entityId: req.params.id, action: 'update', summary: `Updated ${lines.length} schedule lines` });
    res.json(ok({ updated: lines.length }));
  }),
);

// Set customer default schedule
rateSchedulesRouter.put(
  '/:id/set-default',
  ah(async (req, res) => {
    const [sched] = await db.select().from(rateSchedules).where(eq(rateSchedules.id, req.params.id));
    if (!sched) throw new HttpError(404, 'not_found', 'Schedule not found');
    await db.update(customers).set({ defaultRateScheduleId: sched.id }).where(eq(customers.id, sched.customerId));
    res.json(ok({ default_rate_schedule_id: sched.id }));
  }),
);

rateSchedulesRouter.delete(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    // Pre-check FK references that would otherwise surface as raw 500s:
    // a customer pointing at this schedule as their default. Invoices
    // snapshot their rates so they don't reference the schedule directly.
    const [{ n: defaultRefs }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(eq(customers.defaultRateScheduleId, req.params.id));
    if (defaultRefs > 0) {
      return res.status(409).json(fail('in_use', `Cannot delete: ${defaultRefs} customer(s) use this as their default schedule. Pick a different default first.`));
    }
    await db.transaction(async (tx) => {
      await tx.delete(rateScheduleLines).where(eq(rateScheduleLines.scheduleId, req.params.id));
      await tx.delete(rateSchedules).where(eq(rateSchedules.id, req.params.id));
    });
    await writeAudit({ userId: req.user?.id, entityType: 'rate_schedule', entityId: req.params.id, action: 'delete', summary: `Deleted rate schedule` });
    res.json(ok({ deleted: true }));
  }),
);
