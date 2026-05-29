import { Router } from 'express';
import { ok } from '@darrow/shared';
import { db, auditLog } from '@darrow/db';
import { and, eq, gte, lte, desc, sql } from 'drizzle-orm';
import { ah } from '../error-handler.js';
import { requireRole } from '../middleware/auth.js';

export const auditRouter = Router();

auditRouter.get(
  '/',
  requireRole('admin', 'owner'),
  ah(async (req, res) => {
    const { entity_type, entity_id, from, to } = req.query as Record<string, string>;
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const pageSize = 50;
    const conds = [];
    if (entity_type) conds.push(eq(auditLog.entityType, entity_type));
    if (entity_id) conds.push(eq(auditLog.entityId, entity_id));
    if (from) conds.push(gte(auditLog.at, new Date(from)));
    if (to) conds.push(lte(auditLog.at, new Date(to)));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.at))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(auditLog).where(where);
    res.json(ok({ entries: rows, page, pageSize, total: count }));
  }),
);
