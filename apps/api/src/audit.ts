// Audit log service (Phase 2 task 16). Called by all later phases.
import { db, auditLog } from '@darrow/db';
import { logger } from './logger.js';

export interface AuditInput {
  userId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  detail?: unknown;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: input.userId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      summary: input.summary,
      detail: input.detail === undefined ? null : (input.detail as object),
    });
  } catch (err) {
    // Audit failures must never break the primary operation.
    logger.error('writeAudit failed', { err: String(err), input });
  }
}
