/*
 * Backoff arithmetic for credential submission, SPEC.md §3.4.
 *
 * Pure, so it can be unit tested without a database or a clock. lib/auth.ts
 * owns the Postgres query that supplies the failure timestamps — the counters
 * live in Postgres, never in a module-level map, because SPEC.md §10.2 forbids
 * in-memory state across requests and an in-process limiter silently stops
 * limiting the moment there is a second container.
 */

/** SPEC.md §3.4: "5 attempts per IP, then exponential backoff." */
export const FREE_ATTEMPTS = 5;

export const ATTEMPT_WINDOW_MINUTES = 60;
export const ATTEMPT_RETENTION_HOURS = 24;

/*
 * SPEC.md §3.4 mandates the backoff but does not fix the ceiling. It is capped
 * at a minute rather than something longer because of how this event actually
 * works: all 17 guests are on one home wifi and therefore share one public IP.
 * A long ceiling means one person fumbling their code locks the whole party
 * out. A minute still makes grinding a 6-digit code hopeless — 17 valid codes
 * in a space of a million.
 */
export const MAX_BACKOFF_SECONDS = 60;

export type RateLimitVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** 2s, 4s, 8s, 16s, 32s, then pinned at MAX_BACKOFF_SECONDS. */
export function backoffSecondsFor(failureCount: number): number {
  if (failureCount < FREE_ATTEMPTS) return 0;
  return Math.min(2 ** (failureCount - FREE_ATTEMPTS + 1), MAX_BACKOFF_SECONDS);
}

/**
 * @param failureCount  failures from this IP inside the window
 * @param lastFailureMs epoch ms of the most recent failure, null if none
 */
export function evaluateRateLimit(
  failureCount: number,
  lastFailureMs: number | null,
  nowMs: number,
): RateLimitVerdict {
  if (failureCount < FREE_ATTEMPTS || lastFailureMs === null) return { allowed: true };

  const waitMs = lastFailureMs + backoffSecondsFor(failureCount) * 1000 - nowMs;
  if (waitMs <= 0) return { allowed: true };

  return { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) };
}
