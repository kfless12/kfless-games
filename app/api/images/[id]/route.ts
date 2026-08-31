import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { images } from '@/lib/db/schema';
import { isUuid } from '@/lib/uuid';

/*
 * Serves an image out of Postgres. SPEC.md §9.3.
 *
 * Public on purpose: photos and logos appear on the public standings, brackets,
 * and queue, which SPEC.md §3.4 gives PUBLIC read access to.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Postgres raises on a malformed uuid, so filter before querying.
  if (!isUuid(id)) return new Response('Not found', { status: 404 });

  const [image] = await getDb()
    .select({ bytes: images.bytes, mimeType: images.mimeType, byteSize: images.byteSize })
    .from(images)
    .where(eq(images.id, id))
    .limit(1);

  if (!image) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(image.byteSize),
      // Safe to cache forever: replacing an image mints a new id, so this URL's
      // bytes never change. Each browser fetches a given image exactly once,
      // and a replacement still shows up immediately.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
