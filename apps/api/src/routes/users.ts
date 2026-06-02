// Admin-only user management. Mounted at /api/users; sits behind requireAuth
// + requireRole('admin', 'owner') so non-admin sessions are rejected up at
// app.ts (the role gate is applied at mount time).
//
// Safety rails enforced here:
//   - Never expose password_hash (returns are stripped to safe fields).
//   - Cannot delete or deactivate the last active admin — prevents lockout.
//   - Cannot delete yourself (you can still deactivate yourself if another
//     admin exists, but most operators won't want to).
//   - Password resets generate a fresh random one and return it in the
//     response exactly once. The admin reads it, hands it over, and it's
//     gone — never logged, never queryable.
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { eq, and, ne, sql as drSql } from 'drizzle-orm';
import { db, users } from '@darrow/db';
import { ok, fail } from '@darrow/shared';
import { ah, HttpError } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../audit.js';

export const usersRouter = Router();

function genPassword(): string {
  return randomBytes(15).toString('base64url');
}

function publicShape<T extends { passwordHash: string }>(u: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _, ...rest } = u;
  void _;
  return rest;
}

async function countActiveAdmins(excludeId?: string): Promise<number> {
  const where = excludeId
    ? and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, excludeId))
    : and(eq(users.role, 'admin'), eq(users.active, true));
  const [row] = await db.select({ n: drSql<number>`count(*)::int` }).from(users).where(where);
  return Number(row?.n ?? 0);
}

usersRouter.get(
  '/',
  ah(async (_req, res) => {
    const rows = await db.select().from(users).orderBy(users.username);
    res.json(ok(rows.map(publicShape)));
  }),
);

const createSchema = z.object({
  username: z.string().trim().min(3).max(60).regex(/^[a-zA-Z0-9._@-]+$/, 'letters, digits, . _ @ - only'),
  role: z.enum(['admin', 'owner']).default('admin'),
  // Optional explicit password; otherwise generate.
  password: z.string().min(12).max(200).optional(),
});

usersRouter.post(
  '/',
  ah(async (req: AuthedRequest, res) => {
    const body = createSchema.parse(req.body);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, body.username)).limit(1);
    if (existing.length) return res.status(409).json(fail('exists', `Username "${body.username}" is taken`));
    const password = body.password ?? genPassword();
    const hash = bcrypt.hashSync(password, 12);
    const [row] = await db
      .insert(users)
      .values({ username: body.username, passwordHash: hash, role: body.role, active: true })
      .returning();
    await writeAudit({ userId: req.user?.id, entityType: 'user', entityId: row.id, action: 'create', summary: `Created user ${row.username} (${row.role})` });
    // Echo the (generated) password back exactly once. The admin must record
    // it; we never store it in plaintext.
    res.status(201).json(ok({ ...publicShape(row), generated_password: body.password ? undefined : password }));
  }),
);

const updateSchema = z.object({
  username: z.string().trim().min(3).max(60).regex(/^[a-zA-Z0-9._@-]+$/).optional(),
  role: z.enum(['admin', 'owner']).optional(),
  active: z.boolean().optional(),
});

usersRouter.put(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const body = updateSchema.parse(req.body);
    const [target] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!target) throw new HttpError(404, 'not_found', 'User not found');

    // Deactivating or demoting the last active admin would lock the system.
    const willLoseAdmin =
      (body.active === false && target.role === 'admin' && target.active) ||
      (body.role && body.role !== 'admin' && target.role === 'admin' && target.active);
    if (willLoseAdmin) {
      const others = await countActiveAdmins(target.id);
      if (others === 0) {
        return res.status(409).json(fail('last_admin', 'Cannot deactivate or demote the only active admin'));
      }
    }

    // Username uniqueness on rename.
    if (body.username && body.username !== target.username) {
      const dup = await db.select({ id: users.id }).from(users).where(eq(users.username, body.username)).limit(1);
      if (dup.length) return res.status(409).json(fail('exists', `Username "${body.username}" is taken`));
    }

    const [row] = await db
      .update(users)
      .set({ username: body.username, role: body.role, active: body.active })
      .where(eq(users.id, target.id))
      .returning();
    await writeAudit({ userId: req.user?.id, entityType: 'user', entityId: row.id, action: 'update', summary: `Updated user ${row.username}` });
    res.json(ok(publicShape(row)));
  }),
);

usersRouter.post(
  '/:id/reset-password',
  ah(async (req: AuthedRequest, res) => {
    const [target] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!target) throw new HttpError(404, 'not_found', 'User not found');
    const password = genPassword();
    await db.update(users).set({ passwordHash: bcrypt.hashSync(password, 12) }).where(eq(users.id, target.id));
    await writeAudit({ userId: req.user?.id, entityType: 'user', entityId: target.id, action: 'update', summary: `Reset password for ${target.username}` });
    res.json(ok({ password }));
  }),
);

usersRouter.delete(
  '/:id',
  ah(async (req: AuthedRequest, res) => {
    const [target] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!target) throw new HttpError(404, 'not_found', 'User not found');
    if (req.user?.id === target.id) {
      return res.status(409).json(fail('self', 'Cannot delete the user you are signed in as'));
    }
    if (target.role === 'admin' && target.active) {
      const others = await countActiveAdmins(target.id);
      if (others === 0) {
        return res.status(409).json(fail('last_admin', 'Cannot delete the only active admin'));
      }
    }
    await db.delete(users).where(eq(users.id, target.id));
    await writeAudit({ userId: req.user?.id, entityType: 'user', entityId: target.id, action: 'deactivate', summary: `Deleted user ${target.username}` });
    res.json(ok({ deleted: true }));
  }),
);
