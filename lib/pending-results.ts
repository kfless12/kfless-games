/*
 * Score entry has to survive a dropped request. SPEC.md §8: hold the form state
 * in localStorage, retry the POST on failure, and show a persistent "not saved
 * yet" badge until it succeeds.
 *
 * This is the entire offline story. SPEC.md §12 rejects service workers and
 * background sync — the realistic failure is one dropped request on bad wifi,
 * not a two-hour outage, and Safari has never implemented Background Sync
 * anyway. So: keep it in localStorage, retry while the page is open, and be
 * honest on screen until it lands.
 *
 * The list handling is pure and lives here so it can be tested without a
 * browser. The hook that owns the timer and the storage is separate.
 */

export type PendingResult = {
  /** Stable per match, so a re-submission replaces rather than queues twice. */
  matchId: string;
  winnerEntryId: string;
  /** Entry id -> score. Empty when the game is not scored by cups. */
  scores: Record<string, number>;
  /** When it was first queued, for the badge and for giving up. */
  queuedAt: number;
  attempts: number;
  /** Last error, shown on the badge so a rejection is not mistaken for wifi. */
  lastError?: string;
};

/** Enough for a whole game's worth of unsent results on a bad connection. */
export const MAX_PENDING = 32;

/**
 * Retry backoff: 2s, 4s, 8s, 16s, then every 30s.
 *
 * Capped low on purpose — the person is standing at the table waiting to see
 * the result land, so a long backoff reads as broken.
 */
export function retryDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(2 ** attempts * 1000, 30_000);
}

/**
 * Adds or replaces an entry. Re-submitting the same match replaces the pending
 * one rather than queueing a second: the newest answer is the one that counts,
 * and sending both would make the result depend on arrival order.
 */
export function upsertPending(list: PendingResult[], entry: PendingResult): PendingResult[] {
  const withoutMatch = list.filter((item) => item.matchId !== entry.matchId);
  const next = [...withoutMatch, entry];
  // Oldest first, so a cap drops the newest rather than silently losing the
  // thing somebody has been staring at longest.
  return next.slice(-MAX_PENDING);
}

export function removePending(list: PendingResult[], matchId: string): PendingResult[] {
  return list.filter((item) => item.matchId !== matchId);
}

export function markAttempted(
  list: PendingResult[],
  matchId: string,
  error: string,
): PendingResult[] {
  return list.map((item) =>
    item.matchId === matchId
      ? { ...item, attempts: item.attempts + 1, lastError: error }
      : item,
  );
}

/** The next entry due a retry, or null if none is due yet. */
export function nextDue(list: PendingResult[], now: number): PendingResult | null {
  for (const item of list) {
    const dueAt = item.queuedAt + retryDelayMs(item.attempts);
    if (dueAt <= now) return item;
  }
  return null;
}

/**
 * Parses whatever was in localStorage.
 *
 * Never throws: storage can hold anything, including a half-written value from
 * a browser killed mid-write, and a crashed dashboard is worse than a lost
 * retry. Anything unrecognisable is dropped.
 */
export function parsePending(raw: string | null): PendingResult[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter(isPendingResult).slice(-MAX_PENDING);
}

export function serializePending(list: PendingResult[]): string {
  return JSON.stringify(list);
}

function isPendingResult(value: unknown): value is PendingResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.matchId !== 'string' || candidate.matchId === '') return false;
  if (typeof candidate.winnerEntryId !== 'string' || candidate.winnerEntryId === '') return false;
  if (typeof candidate.queuedAt !== 'number' || !Number.isFinite(candidate.queuedAt)) return false;
  if (typeof candidate.attempts !== 'number' || !Number.isFinite(candidate.attempts)) return false;

  const scores = candidate.scores;
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return false;
  for (const score of Object.values(scores as Record<string, unknown>)) {
    if (typeof score !== 'number' || !Number.isFinite(score)) return false;
  }

  return true;
}

/**
 * Whether an error means "try again" or "stop trying".
 *
 * A rejection from the server — not your turn, match already decided — will
 * never succeed on retry, so it stops and shows the reason. Only a transport
 * failure is worth retrying.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch's network failure
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = String((error as { name: unknown }).name);
    if (name === 'AbortError' || name === 'TimeoutError' || name === 'NetworkError') return true;
  }
  return false;
}
