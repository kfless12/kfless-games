import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * Session cookie format and role resolution.
 *
 * Internal plumbing for lib/auth.ts, split out for two reasons: it imports
 * nothing from next/headers, so it can be unit tested outside a request, and
 * SPEC.md §3.1 wants lib/auth.ts's feature-facing surface to stay narrow —
 * feature code still only ever calls identify(). Nothing outside lib/auth.ts
 * should import this module.
 *
 * The secret is a parameter rather than read from the environment here, so the
 * tests can exercise signing without touching process.env.
 */

export const COOKIE_NAME = 'kfless_session';

/**
 * 90 days, per SPEC.md §3.2. Deliberately outlasts the event: an expired-link
 * screen on Saturday night is a failure, not a security win.
 */
export const SESSION_DAYS = 90;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

const COOKIE_VERSION = 'v1';

export type Role = 'ADMIN' | 'CAPTAIN' | 'PLAYER';

export type Session = { personId: string; elevated: boolean };

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * `v1.<personId>.<expiryEpochSeconds>.<elevated>.<hmac>`
 *
 * `elevated` records a break-glass ADMIN_CREDENTIAL elevation. It is inside the
 * signed payload, so it cannot be flipped client-side.
 */
export function serializeSession(
  secret: string,
  personId: string,
  expiresAtEpochSeconds: number,
  elevated: boolean,
): string {
  const payload = `${COOKIE_VERSION}.${personId}.${expiresAtEpochSeconds}.${elevated ? '1' : '0'}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** Returns null for anything not currently valid: forged, stale, or malformed. */
export function parseSession(
  secret: string,
  raw: string | undefined,
  nowMs: number = Date.now(),
): Session | null {
  if (!raw) return null;

  const parts = raw.split('.');
  if (parts.length !== 5) return null;

  const [version, personId, expiresAtRaw, elevatedRaw, mac] = parts;
  if (version !== COOKIE_VERSION) return null;
  if (!personId) return null;
  if (elevatedRaw !== '0' && elevatedRaw !== '1') return null;

  const payload = `${version}.${personId}.${expiresAtRaw}.${elevatedRaw}`;
  const expected = Buffer.from(sign(secret, payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= nowMs) return null;

  return { personId, elevated: elevatedRaw === '1' };
}

/**
 * ADMIN sits above CAPTAIN: SPEC.md §5.4 lets the admin pick on behalf of any
 * captain, and §8 lets the admin submit any result. An admin who is also a
 * captain resolves to ADMIN and keeps captain powers through the helpers in
 * lib/auth.ts.
 */
export function resolveRole(isAdmin: boolean, isCaptain: boolean): Role {
  if (isAdmin) return 'ADMIN';
  if (isCaptain) return 'CAPTAIN';
  return 'PLAYER';
}

export function readCookieFromHeader(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
