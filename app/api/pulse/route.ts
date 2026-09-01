/*
 * A deliberately tiny endpoint the poller can actually fail against.
 *
 * router.refresh() gives no success or failure signal, so SPEC.md §7.3's
 * "reconnecting state on failure" needs something that does. This touches no
 * database — it only answers whether the server is reachable, which is exactly
 * the question the badge is asking.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response('ok', {
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
