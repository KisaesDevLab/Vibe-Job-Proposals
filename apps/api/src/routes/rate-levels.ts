import { Router } from 'express';
import { ok, fail, rateLevelSchema } from '@darrow/shared';
import { db, rateLevels, employees } from '@darrow/db';
import { eq, asc, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../audit.js';

export const rateLevelsRouter = Router();

rateLevelsRouter.get(
  '/',
  ah(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const rows = await db.select().from(rateLevels).orderBy(asc(rateLevels.sortOrder));
    const counts = await db
      .select({ levelId: employees.levelId, n: sql<number>`count(*)::int` })
      .from(employees)
      .groupBy(employees.levelId);
    const countMap = new Map(counts.map((c) => [c.levelId, c.n]));
    const data = rows
      .filter((r) => includeInactive || r.active)
      .map((r) => ({ ...r, employee_count: countMap.get(r.id) ?? 0 }));
    res.json(ok(data));
  }),
);

rateLevelsRouter.post(
  '/',
  ah(async (req: AuthedRequest, res) => {
    const body = rateLevelSchema.parse(req.body);
    const [max] = await db.select({ m: sql<number>`coalesce(max(sort_order),-1)::int` }).from(rateLevels);
    const [row] = await db
      .insert(rateLevels)
      .values({ name: body.name, sortOrder: body.sort_order ?? max.m + 1, active: body.active ?? true })
      .returning();
    await writeAudit({ userId: req.user?.id, entityType: 'rate_level', entityId: row.id, action: 'create', summary: `Created level ${row.name}` });
    res.status(201).json(ok(row));
  }),
);

rateLevelsRouter.put(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const body = rateLevelSchema.partial().parse(req.body);
    const [row] = await db
      .update(rateLevels)
      .set({ name: body.name, sortOrder: body.sort_order, active: body.active })
      .where(eq(rateLevels.id, req.params.id))
      .returning();
    if (!row) throw new HttpError(404, 'not_found', 'Rate level not found');
    await writeAudit({ userId: req.user?.id, entityType: 'rate_level', entityId: row.id, action: 'update', summary: `Updated level ${row.name}` });
    res.json(ok(row));
  }),
);

rateLevelsRouter.delete(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(employees)
      .where(eq(employees.levelId, req.params.id));
    if (n > 0) return res.status(409).json(fail('in_use', `In use by ${n} employees`, { count: n }));
    await db.delete(rateLevels).where(eq(rateLevels.id, req.params.id));
    await writeAudit({ userId: req.user?.id, entityType: 'rate_level', entityId: req.params.id, action: 'delete', summary: 'Deleted rate level' });
    res.json(ok({ deleted: true }));
  }),
);

rateLevelsRouter.patch(
  '/reorder',
  ah(async (req: AuthedRequest, res) => {
    const items = z.array(z.object({ id: z.string().uuid(), sort_order: z.number().int() })).parse(req.body);
    await db.transaction(async (tx) => {
      for (const it of items) {
        await tx.update(rateLevels).set({ sortOrder: it.sort_order }).where(eq(rateLevels.id, it.id));
      }
    });
    const rows = await db.select().from(rateLevels).where(inArray(rateLevels.id, items.map((i) => i.id)));
    res.json(ok(rows));
  }),
);
