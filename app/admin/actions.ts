'use server';

import { revalidatePath } from 'next/cache';

import type { AdminActionState } from './state';

import { recordAudit } from '@/lib/audit';
import {
  clientIp,
  elevateToAdmin,
  identify,
  isAdmin,
  issueCredential,
  revokeCredential,
} from '@/lib/auth';

/**
 * Server-side authorization on every action. SPEC.md §6 of CLAUDE.md: never
 * rely on a hidden or disabled button to prevent an action.
 */
async function requireAdmin() {
  const identity = await identify();
  if (!isAdmin(identity)) return null;
  return identity;
}

/**
 * Issue, re-issue, or revoke one person's credential.
 *
 * One action rather than two so there is one piece of state and therefore one
 * message. With two useActionState hooks the stale notice from whichever ran
 * first kept winning, and the admin saw "new link issued" after a revoke.
 */
export async function manageCredential(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await requireAdmin();
  if (!actor) return { error: 'Not allowed.', notice: null };

  const playerId = String(formData.get('playerId') ?? '');
  const operation = String(formData.get('operation') ?? '');

  if (!playerId) return { error: 'Missing player.', notice: null };
  if (operation !== 'issue' && operation !== 'revoke') {
    return { error: 'Unknown operation.', notice: null };
  }

  if (operation === 'revoke') {
    await revokeCredential(playerId);
    await recordAudit({
      actor,
      action: 'credential.revoke',
      targetType: 'player',
      targetId: playerId,
    });
    revalidatePath('/admin');
    return { error: null, notice: 'Revoked. That link and code no longer work.' };
  }

  await issueCredential(playerId);
  await recordAudit({
    actor,
    action: 'credential.issue',
    targetType: 'player',
    targetId: playerId,
  });
  revalidatePath('/admin');
  return { error: null, notice: 'New link and code issued. Any previous ones stopped working.' };
}

/** Break-glass elevation. Requires an existing identity, so the audit log keeps an actor. */
export async function elevate(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const credential = String(formData.get('credential') ?? '');
  const result = await elevateToAdmin(credential, await clientIp());

  if (result.ok) {
    const actor = await identify();
    await recordAudit({ actor, action: 'admin.elevate', targetType: 'session' });
    revalidatePath('/admin');
    return { error: null, notice: 'Elevated.' };
  }

  if (result.reason === 'RATE_LIMITED') {
    const seconds = result.retryAfterSeconds ?? 60;
    return { error: `Too many tries. Wait ${seconds}s.`, notice: null };
  }
  if (result.reason === 'NOT_SIGNED_IN') {
    return { error: 'Use your own link or code first, then come back here.', notice: null };
  }
  return { error: 'Wrong credential.', notice: null };
}
