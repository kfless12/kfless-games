import { eq } from 'drizzle-orm';

import { identify } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { images } from '@/lib/db/schema';
import { isUuid } from '@/lib/uuid';

/*
 * Serves an image out of Postgres. SPEC.md §9.3.
 *
 * Credential required, like everything else (SPEC.md §3.4). These are people's
 * faces: leaving the bytes reachable to anyone with the id would undo the gate
 * on every page that shows them, since the id is right there in the HTML.
 *
 * Unidentified callers get 404 rather than 401/403, so the response says
 * nothing about whether that id exists.
 *
 * requireIdentity() is deliberately not used here — redirecting an <img> to the
 * join page would render the HTML login screen as a broken image.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!(await identify())) return new Response('Not found', { status: 404 });

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
      /*
       * private, not public. The bytes still never change — replacing an image
       * mints a new id — so the browser may keep it forever. But this is now
       * credentialed content, and `public` would invite the CDN in front of the
       * app to hold a copy and serve someone's photo to a visitor with no
       * cookie, which is the exact hole this route just closed. Vary says the
       * same thing to any intermediary that ignores private.
       */
      'Cache-Control': 'private, max-age=31536000, immutable',
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
