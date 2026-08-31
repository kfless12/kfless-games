import { clientIp, redeemToken } from '@/lib/auth';

/**
 * The magic link. SPEC.md §3.2: one tap, forever.
 *
 * A route handler rather than a page because redemption sets a cookie, which a
 * server component cannot do. The token is a path segment, never a query
 * string — SPEC.md §3.4.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = await redeemToken(token, await clientIp());

  // Relative Location, which HTTP allows. Building an absolute URL from
  // request.url would send the browser to the container's own bind address
  // (0.0.0.0:3000), and trusting X-Forwarded-Host instead would depend on
  // whichever host is chosen later.
  const location = result.ok ? '/' : '/join?invalid=link';

  // `invalid` is a UI flag, not a credential, so it is safe in a query string.
  return new Response(null, { status: 303, headers: { Location: location } });
}
