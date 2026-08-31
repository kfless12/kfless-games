import { createHmac, timingSafeEqual } from 'node:crypto';

import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';

import { joinPathFor, newJoinCode, newToken } from '@/lib/credentials';
import { getDb } from '@/lib/db';
import { authAttempts, credentials, players } from '@/lib/db/schema';
import { requireEnv } from '@/lib/env';

/*
 * The only auth module. SPEC.md §3.1: every route handler and every server
 * component asks identify() and nothing else. No feature code reads a token or
 * a join code directly — that is why the listing and redemption helpers live
 * here too, rather than letting the admin page query the credentials table.
 *
 * Strategy: per-person magic links with a 6-digit day-of fallback (SPEC.md §3.2).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Role = 'ADMIN' | 'CAPTAIN' | 'PLAYER';

/** Exactly the shape SPEC.md §3.1 specifies. */
export type Identity = {
  personId: string;
  teamId: string | null;
  role: Role;
};

export type IssuedCredential = {
  playerId: string;
  joinPath: string;
  joinCode: string;
};

// ---------------------------------------------------------------------------
// Cookie
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'kfless_session';

/**
 * 90 days, per SPEC.md §3.2. Deliberately outlasts the event: an expired-link
 * screen on Saturday night is a failure, not a security win.
 */
const SESSION_DAYS = 90;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

const COOKIE_VERSION = 'v1';

function sign(payload: string): string {
  return createHmac('sha256', requireEnv('SESSION_SECRET')).update(payload).digest('base64url');
}

/**
 * `v1.<personId>.<expiryEpochSeconds>.<elevated>.<hmac>`
 *
 * `elevated` records a break-glass ADMIN_CREDENTIAL elevation. It is inside the
 * signed payload, so it cannot be flipped client-side.
 */
function serializeSession(personId: string, expiresAt: number, elevated: boolean): string {
  const payload = `${COOKIE_VERSION}.${personId}.${expiresAt}.${elevated ? '1' : '0'}`;
  return `${payload}.${sign(payload)}`;
}

type Session = { personId: string; elevated: boolean };

function parseSession(raw: string | undefined): Session | null {
  if (!raw) return null;

  const parts = raw.split('.');
  if (parts.length !== 5) return null;

  const [version, personId, expiresAtRaw, elevatedRaw, mac] = parts;
  if (version !== COOKIE_VERSION) return null;

  const payload = `${version}.${personId}.${expiresAtRaw}.${elevatedRaw}`;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) return null;

  return { personId, elevated: elevatedRaw === '1' };
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_SECONDS,
  };
}

async function setSessionCookie(personId: string, elevated: boolean) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const store = await cookies();
  store.set(COOKIE_NAME, serializeSession(personId, expiresAt, elevated), cookieOptions());
}

/** Sign out. Only callable from a route handler or server action. */
export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// ---------------------------------------------------------------------------
// identify
// ---------------------------------------------------------------------------

/**
 * The single entry point. SPEC.md §3.1 writes this as `identify(request)`; the
 * request is optional here because Next's cookies() is request-scoped and works
 * in both server components and route handlers, where no Request object is in
 * hand. Pass one explicitly from middleware or a test if you have it.
 *
 * Returns null for PUBLIC (no cookie). PUBLIC gets read-only access to
 * everything except the admin console and the draft-pick action — SPEC.md §3.4.
 */
export async function identify(request?: Request): Promise<Identity | null> {
  const raw = request
    ? readCookieFromHeader(request.headers.get('cookie'), COOKIE_NAME)
    : (await cookies()).get(COOKIE_NAME)?.value;

  const session = parseSession(raw);
  if (!session) return null;

  const db = getDb();
  const [player] = await db
    .select({
      id: players.id,
      teamId: players.teamId,
      isAdmin: players.isAdmin,
      isCaptain: players.isCaptain,
    })
    .from(players)
    .where(eq(players.id, session.personId))
    .limit(1);

  // Cookie signed for a player who no longer exists.
  if (!player) return null;

  return {
    personId: player.id,
    teamId: player.teamId,
    role: resolveRole(player.isAdmin || session.elevated, player.isCaptain),
  };
}

function resolveRole(isAdmin: boolean, isCaptain: boolean): Role {
  if (isAdmin) return 'ADMIN';
  if (isCaptain) return 'CAPTAIN';
  return 'PLAYER';
}

function readCookieFromHeader(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Authorization helpers
//
// ADMIN sits above CAPTAIN: SPEC.md §5.4 lets the admin pick on behalf of any
// captain, and §8 lets the admin submit any result. Feature code should call
// these rather than comparing role strings, so an admin who is also a captain
// never loses captain powers.
// ---------------------------------------------------------------------------

export function isAdmin(identity: Identity | null): boolean {
  return identity?.role === 'ADMIN';
}

export function canActForTeam(identity: Identity | null, teamId: string): boolean {
  if (!identity) return false;
  if (identity.role === 'ADMIN') return true;
  return identity.role === 'CAPTAIN' && identity.teamId === teamId;
}

// ---------------------------------------------------------------------------
// Rate limiting — SPEC.md §3.4
//
// State lives in Postgres, not a module-level map: an in-process limiter
// silently stops limiting the moment there is a second container, and SPEC.md
// §10.2 forbids in-memory state across requests.
// ---------------------------------------------------------------------------

const FREE_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MINUTES = 60;

/*
 * SPEC.md §3.4 mandates "5 attempts per IP, then exponential backoff" but does
 * not fix the ceiling. It is capped at a minute rather than something longer
 * because of how this event actually works: all 17 guests are on one home wifi
 * and therefore share one public IP. A long ceiling means one person fumbling
 * their code locks the whole party out. A minute is still enough to make
 * grinding a 6-digit code hopeless — 17 valid codes in a space of a million.
 */
const MAX_BACKOFF_SECONDS = 60;
const ATTEMPT_RETENTION_HOURS = 24;

export type RateLimitVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * 5 failures per IP are free, then exponential backoff: 2s, 4s, 8s, ... capped
 * at MAX_BACKOFF_SECONDS. Only failures count, and a success clears the IP's
 * history (see recordAttempt), so one person finally getting in unblocks
 * everyone else sharing that wifi immediately.
 */
export async function checkRateLimit(ip: string): Promise<RateLimitVerdict> {
  const db = getDb();

  // No cron in this app (SPEC.md §10.2), so prune opportunistically.
  await db.delete(authAttempts).where(
    sql`${authAttempts.attemptedAt} < now() - interval '${sql.raw(String(ATTEMPT_RETENTION_HOURS))} hours'`,
  );

  const since = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60 * 1000);
  const failures = await db
    .select({ attemptedAt: authAttempts.attemptedAt })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.ip, ip),
        eq(authAttempts.succeeded, false),
        gte(authAttempts.attemptedAt, since),
      ),
    )
    .orderBy(desc(authAttempts.attemptedAt));

  if (failures.length < FREE_ATTEMPTS) return { allowed: true };

  const backoffSeconds = Math.min(
    2 ** (failures.length - FREE_ATTEMPTS + 1),
    MAX_BACKOFF_SECONDS,
  );
  const lastFailureAt = failures[0].attemptedAt.getTime();
  const readyAt = lastFailureAt + backoffSeconds * 1000;
  const waitMs = readyAt - Date.now();

  if (waitMs <= 0) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) };
}

async function recordAttempt(ip: string, succeeded: boolean) {
  const db = getDb();
  await db.insert(authAttempts).values({ ip, succeeded });

  // A correct credential from this IP clears its backoff. Everyone at the event
  // shares one public IP, so without this a single person mistyping their code
  // would hold up the next person in the queue behind them.
  if (succeeded) {
    await db.delete(authAttempts).where(and(eq(authAttempts.ip, ip), eq(authAttempts.succeeded, false)));
  }
}

/**
 * Client IP as reported by the proxy. Spoofable, which is fine: SPEC.md §3.2
 * states the threat model is "a friend being annoying, not an attacker".
 */
export async function clientIp(): Promise<string> {
  const store = await headers();
  const forwarded = store.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return store.get('x-real-ip') ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Credential issue / revoke — SPEC.md §3.1, §3.2
// ---------------------------------------------------------------------------

export { joinPathFor } from '@/lib/credentials';

/**
 * Issues (or re-issues) this person's credential and returns their join link.
 *
 * SPEC.md §3.1 types this as returning a string, so it returns the link — the
 * primary credential. The 6-digit fallback code is read back through
 * listCredentials(), which the admin console uses.
 *
 * Re-issuing revokes the previous credential, so a leaked link stops working.
 */
export async function issueCredential(personId: string): Promise<string> {
  const db = getDb();

  return db.transaction(async (tx) => {
    await tx
      .update(credentials)
      .set({ revokedAt: new Date() })
      .where(and(eq(credentials.playerId, personId), isNull(credentials.revokedAt)));

    // Join codes are only 6 digits, so a collision across 17 people is
    // unlikely but not impossible. onConflictDoNothing rather than try/catch:
    // a failed insert would abort the whole transaction, and every statement
    // after it would fail too.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const token = newToken();
      const joinCode = newJoinCode();
      const inserted = await tx
        .insert(credentials)
        .values({ playerId: personId, token, joinCode })
        .onConflictDoNothing()
        .returning({ id: credentials.id });

      if (inserted.length > 0) return joinPathFor(token);
    }

    throw new Error('could not issue a unique credential after 10 attempts');
  });
}

/** SPEC.md §3.1. Invalidates the link and the code without deleting history. */
export async function revokeCredential(personId: string): Promise<void> {
  await getDb()
    .update(credentials)
    .set({ revokedAt: new Date() })
    .where(and(eq(credentials.playerId, personId), isNull(credentials.revokedAt)));
}

/**
 * For the admin console credential list (SPEC.md §3.2). Lives here because
 * §3.1 forbids feature code reading tokens and codes directly.
 */
export async function listCredentials(): Promise<IssuedCredential[]> {
  const rows = await getDb()
    .select({
      playerId: credentials.playerId,
      token: credentials.token,
      joinCode: credentials.joinCode,
    })
    .from(credentials)
    .where(isNull(credentials.revokedAt));

  return rows.map((row) => ({
    playerId: row.playerId,
    joinPath: joinPathFor(row.token),
    joinCode: row.joinCode,
  }));
}

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

export type RedeemResult =
  | { ok: true; personId: string }
  | { ok: false; reason: 'NOT_FOUND' | 'RATE_LIMITED'; retryAfterSeconds?: number };

async function redeem(
  where: ReturnType<typeof eq>,
  ip: string,
  rateLimited: boolean,
): Promise<RedeemResult> {
  if (rateLimited) {
    const verdict = await checkRateLimit(ip);
    if (!verdict.allowed) {
      return { ok: false, reason: 'RATE_LIMITED', retryAfterSeconds: verdict.retryAfterSeconds };
    }
  }

  const [row] = await getDb()
    .select({ playerId: credentials.playerId })
    .from(credentials)
    .where(and(where, isNull(credentials.revokedAt)))
    .limit(1);

  await recordAttempt(ip, Boolean(row));
  if (!row) return { ok: false, reason: 'NOT_FOUND' };

  await setSessionCookie(row.playerId, false);
  return { ok: true, personId: row.playerId };
}

/**
 * Magic link. Token is 256 bits of randomness, so it is not brute-forceable and
 * is not rate limited — the limit is reserved for the 6-digit code, where it is
 * the actual defence.
 */
export function redeemToken(token: string, ip: string): Promise<RedeemResult> {
  return redeem(eq(credentials.token, token), ip, false);
}

/** Day-of fallback. Rate limited per SPEC.md §3.4. */
export function redeemJoinCode(code: string, ip: string): Promise<RedeemResult> {
  return redeem(eq(credentials.joinCode, code), ip, true);
}

// ---------------------------------------------------------------------------
// Break-glass admin elevation
//
// The admin is one of the 17 and gets ADMIN from players.is_admin. This exists
// for the case where that flag is wrong, or the admin is signed in on a
// borrowed phone. It requires an existing identity, so audit_log always has a
// real actor_person_id.
// ---------------------------------------------------------------------------

export type ElevateResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_SIGNED_IN' | 'BAD_CREDENTIAL' | 'RATE_LIMITED'; retryAfterSeconds?: number };

export async function elevateToAdmin(credential: string, ip: string): Promise<ElevateResult> {
  const identity = await identify();
  if (!identity) return { ok: false, reason: 'NOT_SIGNED_IN' };

  const verdict = await checkRateLimit(ip);
  if (!verdict.allowed) {
    return { ok: false, reason: 'RATE_LIMITED', retryAfterSeconds: verdict.retryAfterSeconds };
  }

  const expected = Buffer.from(requireEnv('ADMIN_CREDENTIAL'));
  const actual = Buffer.from(credential);
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

  await recordAttempt(ip, matches);
  if (!matches) return { ok: false, reason: 'BAD_CREDENTIAL' };

  await setSessionCookie(identity.personId, true);
  return { ok: true };
}
