import type { Request, Response, NextFunction } from 'express';
import { fail } from '@darrow/shared';
import { db, users } from '@darrow/db';
import { eq } from 'drizzle-orm';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

export interface AuthedRequest extends Request {
  user?: { id: string; username: string; role: 'admin' | 'owner' };
}

const WHITELIST = [/^\/api\/health$/, /^\/api\/auth\/login$/, /^\/api\/auth\/me$/, /^\/api\/auth\/logout$/, /^\/api\/public\//];

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  if (WHITELIST.some((re) => re.test(req.path))) return next();
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json(fail('unauthorized', 'Authentication required'));
    return;
  }
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !u.active) {
    res.status(401).json(fail('unauthorized', 'Session invalid'));
    return;
  }
  req.user = { id: u.id, username: u.username, role: u.role };
  next();
}

export function requireRole(...roles: Array<'admin' | 'owner'>) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json(fail('forbidden', 'Insufficient role'));
      return;
    }
    next();
  };
}
