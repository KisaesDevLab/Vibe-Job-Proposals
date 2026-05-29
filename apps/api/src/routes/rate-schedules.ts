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
      if (String(e?.message ?? e).includes('no_overlap')) {
        return res.status(409).json(fail('overlap', 'Schedule dates overlap an existing schedule'));
      }
      throw e;
    }
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
    try {
      const [row] = await db
        .update(rateSchedules)
        .set({ name: body.name, effectiveFrom: body.effective_from, effectiveTo: body.effective_to, notes: body.notes })
        .where(eq(rateSchedules.id, req.params.id))
        .returning();
      if (!row) throw new HttpError(404, 'not_found', 'Schedule not found');
      res.json(ok(row));
    } catch (e: any) {
      if (String(e?.message ?? e).includes('no_overlap')) {
        return res.status(409).json(fail('overlap', 'Schedule dates overlap an existing schedule'));
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
  ah(async (req, res) => {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(rateScheduleLines)
      .where(sql`schedule_id = ${req.params.id} AND false`); // placeholder; invoices snapshot rates, no FK ref
    void n;
    await db.delete(rateSchedules).where(eq(rateSchedules.id, req.params.id));
    res.json(ok({ deleted: true }));
  }),
);
