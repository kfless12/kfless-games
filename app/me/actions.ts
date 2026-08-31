'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { identify, isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { players, teams } from '@/lib/db/schema';
import { parseProfileForm } from '@/lib/profile';
import { isUuid } from '@/lib/uuid';
import { deleteImageByUrl, storeImage } from '@/lib/upload';

import type { SaveState } from './state';

/**
 * Someone may edit their own profile; the admin may edit anyone's (SPEC.md
 * §9.1). Checked here on the server, never inferred from what the page chose
 * to render.
 */
async function authorizeProfileEdit(playerId: string) {
  if (!isUuid(playerId)) return null;
  const identity = await identify();
  if (!identity) return null;
  if (identity.personId === playerId || isAdmin(identity)) return identity;
  return null;
}

export async function saveProfile(
  _previous: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const playerId = String(formData.get('playerId') ?? '');
  const actor = await authorizeProfileEdit(playerId);
  if (!actor) return { error: 'Not allowed.', notice: null };

  const parsed = parseProfileForm(formData);
  if (!parsed.ok) return { error: parsed.errors.join(' '), notice: null };

  const db = getDb();
  const [before] = await db
    .select({ photoUrl: players.photoUrl })
    .from(players)
    .where(eq(players.id, playerId))
    .limit(1);

  if (!before) return { error: 'That player no longer exists.', notice: null };

  let photoUrl = before.photoUrl;
  let replacedPhoto: string | null = null;

  const photo = formData.get('photo');
  if (photo instanceof File && photo.size > 0) {
    const stored = await storeImage(photo, actor.personId);
    if (!stored.ok) return { error: stored.error, notice: null };
    replacedPhoto = before.photoUrl;
    photoUrl = stored.url;
  }

  await db
    .update(players)
    .set({ ...parsed.values, photoUrl, updatedAt: new Date() })
    .where(eq(players.id, playerId));

  if (replacedPhoto) await deleteImageByUrl(replacedPhoto);

  await recordAudit({
    actor,
    action: actor.personId === playerId ? 'profile.update' : 'profile.update_by_admin',
    targetType: 'player',
    targetId: playerId,
    after: { photoChanged: Boolean(replacedPhoto || photoUrl !== before.photoUrl) },
  });

  revalidatePath('/me');
  revalidatePath('/admin');
  return { error: null, notice: 'Saved.' };
}

/** SPEC.md §9.2: captains edit their own team's name and logo. Both are logged. */
export async function saveTeam(_previous: SaveState, formData: FormData): Promise<SaveState> {
  const identity = await identify();
  if (!identity) return { error: 'Not allowed.', notice: null };

  const teamId = String(formData.get('teamId') ?? '');
  if (!isUuid(teamId)) return { error: 'Not allowed.', notice: null };

  const db = getDb();

  const [team] = await db
    .select({ id: teams.id, name: teams.name, logoUrl: teams.logoUrl, motto: teams.motto })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);

  if (!team) return { error: 'That team no longer exists.', notice: null };

  // A captain may only touch their own team. The admin may touch any.
  const ownsTeam = identity.teamId === teamId && identity.role === 'CAPTAIN';
  if (!ownsTeam && !isAdmin(identity)) return { error: 'Not allowed.', notice: null };

  const name = String(formData.get('name') ?? '').trim();
  if (name.length === 0) return { error: 'A team needs a name.', notice: null };
  if (name.length > 60) return { error: 'That name is too long.', notice: null };

  const mottoRaw = String(formData.get('motto') ?? '').trim();
  const motto = mottoRaw === '' ? null : mottoRaw;

  let logoUrl = team.logoUrl;
  let replacedLogo: string | null = null;

  const logo = formData.get('logo');
  if (logo instanceof File && logo.size > 0) {
    const stored = await storeImage(logo, identity.personId);
    if (!stored.ok) return { error: stored.error, notice: null };
    replacedLogo = team.logoUrl;
    logoUrl = stored.url;
  }

  await db
    .update(teams)
    .set({ name, motto, logoUrl, updatedAt: new Date() })
    .where(eq(teams.id, teamId));

  if (replacedLogo) await deleteImageByUrl(replacedLogo);

  await recordAudit({
    actor: identity,
    action: 'team.update',
    targetType: 'team',
    targetId: teamId,
    before: { name: team.name, motto: team.motto, logoUrl: team.logoUrl },
    after: { name, motto, logoUrl },
  });

  revalidatePath('/me');
  revalidatePath('/');
  return { error: null, notice: 'Team saved.' };
}
