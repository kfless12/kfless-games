import { randomBytes, randomInt } from 'node:crypto';

/*
 * Credential formats, in one place.
 *
 * Separate from lib/auth.ts because lib/auth.ts imports next/headers and so
 * cannot be loaded by scripts/seed.ts, which runs outside a request. Keeping
 * the formats here means the seed and the app cannot drift apart.
 */

/** 32 random bytes, base64url. The path segment of /join/<token>. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 6 digits, zero-padded, stored as text so leading zeros survive. */
export function newJoinCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function joinPathFor(token: string): string {
  return `/join/${token}`;
}
