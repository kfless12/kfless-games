import { getDb } from '@/lib/db';
import { auditLog } from '@/lib/db/schema';
import type { Identity } from '@/lib/auth';

/**
 * Append-only audit trail. SPEC.md §4.8, §8.
 *
 * Every score submission, score edit, undo, draft pick, draft undo, game
 * create/delete, and team name/logo change goes through here. Credential
 * issue/revoke does too, since it changes who can act as whom.
 *
 * Never throws into the caller's path: losing an audit row is bad, but failing
 * a score submission because the audit insert failed is worse. Failures are
 * logged to stderr.
 */
export async function recordAudit(input: {
  actor: Identity | null;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await getDb()
      .insert(auditLog)
      .values({
        actorPersonId: input.actor?.personId ?? null,
        actorRole: input.actor?.role ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        before: input.before ?? null,
        after: input.after ?? null,
      });
  } catch (error) {
    console.error(`audit_log insert failed for action "${input.action}"`, error);
  }
}
