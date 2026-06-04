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
  try {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u || !u.active) {
      res.status(401).json(fail('unauthorized', 'Session invalid'));
      return;
    }
    req.user = { id: u.id, username: u.username, role: u.role };
    next();
  } catch (err) {
    // Mounted directly (not via ah()); under Express 4 an async rejection won't
    // reach errorHandler on its own. Forward it so a DB outage returns the
    // standard 500 envelope instead of an unhandledRejection.
    next(err);
  }
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
