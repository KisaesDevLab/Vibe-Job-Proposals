import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { ok, fail, loginSchema, changePasswordSchema } from '@darrow/shared';
import { db, users } from '@darrow/db';
import { eq } from 'drizzle-orm';
import { redis } from '../redis.js';
import { ah } from '../error-handler.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../audit.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args: string[]) => (redis as any).call(...args) }),
  message: fail('rate_limited', 'Too many login attempts; try again later'),
});

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req: AuthedRequest, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) {
      return res.status(401).json(fail('invalid_credentials', 'Invalid username or password'));
    }
    req.session.userId = u.id;
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    res.json(ok({ id: u.id, username: u.username, role: u.role }));
  }),
);

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json(ok({ loggedOut: true }));
  });
});

authRouter.get(
  '/me',
  ah(async (req: AuthedRequest, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json(fail('unauthorized', 'Not logged in'));
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u || !u.active) return res.status(401).json(fail('unauthorized', 'Session invalid'));
    res.json(ok({ id: u.id, username: u.username, role: u.role }));
  }),
);

authRouter.post(
  '/change-password',
  ah(async (req: AuthedRequest, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json(fail('unauthorized', 'Not logged in'));
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u || !(await bcrypt.compare(currentPassword, u.passwordHash))) {
      return res.status(400).json(fail('invalid_credentials', 'Current password incorrect'));
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await db.update(users).set({ passwordHash: hash }).where(eq(users.id, userId));
    await writeAudit({ userId, entityType: 'user', entityId: userId, action: 'update', summary: 'Changed password' });
    res.json(ok({ changed: true }));
  }),
);
