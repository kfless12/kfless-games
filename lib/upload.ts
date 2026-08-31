import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { images, players, teams } from '@/lib/db/schema';
import { checkImage, describeRejection } from '@/lib/images';

/*
 * Storing an uploaded image. SPEC.md §9.3.
 *
 * The browser resizes on a canvas before sending, but nothing here trusts that:
 * checkImage() reads the format and dimensions out of the bytes and enforces the
 * caps, so a client that skips the resize is rejected rather than believed.
 */

export type StoredImage = { ok: true; url: string } | { ok: false; error: string };

const MAX_FORM_BYTES = 6 * 1024 * 1024;

export function imageUrlFor(id: string): string {
  return `/api/images/${id}`;
}

/** Extracts the id back out of a stored URL, or null if it isn't one of ours. */
export function imageIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  // Case-insensitive on the hex only. The path is case-sensitive because Next
  // routes are: /api/IMAGES/<id> would 404, so it is not one of ours.
  const match = /^\/api\/images\/([0-9a-fA-F-]{36})$/.exec(url);
  return match ? match[1] : null;
}

export async function storeImage(file: File, uploadedBy: string): Promise<StoredImage> {
  if (file.size === 0) return { ok: false, error: 'No file was chosen.' };

  // Guard before buffering the whole thing into memory.
  if (file.size > MAX_FORM_BYTES) {
    return { ok: false, error: 'That file is too big to upload.' };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkImage(bytes);
  if (!check.ok) return { ok: false, error: describeRejection(check.reason) };

  const [row] = await getDb()
    .insert(images)
    .values({
      mimeType: check.info.mimeType,
      bytes: Buffer.from(bytes),
      byteSize: bytes.length,
      width: check.info.width,
      height: check.info.height,
      uploadedBy,
    })
    .returning({ id: images.id });

  return { ok: true, url: imageUrlFor(row.id) };
}

/**
 * Deletes the image a URL points at, if it is one of ours. Called after a
 * replacement lands, so a swapped photo does not leave bytes behind.
 * Best-effort: a failure here must not fail the profile save.
 */
export async function deleteImageByUrl(url: string | null): Promise<void> {
  const id = imageIdFromUrl(url);
  if (!id) return;

  // Never delete something another row still points at.
  const db = getDb();
  try {
    const stillUsedByPlayer = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.photoUrl, url!))
      .limit(1);
    if (stillUsedByPlayer.length > 0) return;

    const stillUsedByTeam = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.logoUrl, url!))
      .limit(1);
    if (stillUsedByTeam.length > 0) return;

    await db.delete(images).where(eq(images.id, id));
  } catch (error) {
    console.error('could not delete replaced image', id, error);
  }
}
