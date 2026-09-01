'use client';

import { useCallback, useSyncExternalStore } from 'react';

import {
  isRetryable,
  markAttempted,
  nextDue,
  parsePending,
  type PendingResult,
  removePending,
  retryDelayMs,
  serializePending,
  upsertPending,
} from '@/lib/pending-results';

import { submitResult } from './actions';

/*
 * Score entry that survives a dropped request. SPEC.md §8.
 *
 * The submission is written to localStorage before it is sent, retried while the
 * page is open, and a "not saved yet" badge stays up until it lands. Reloading
 * the page picks up where it left off, because the queue is in storage rather
 * than in component state.
 *
 * Deliberately not a service worker or background sync: SPEC.md §12 rejects
 * those, partly because Safari has never implemented Background Sync and most
 * guests will be on iPhones. This covers the realistic failure — one request
 * dropped on bad wifi while somebody is looking at the screen.
 *
 * ONE store for the whole page, not one per component. A bracket page renders
 * fifteen match cards; giving each its own copy of the queue and its own retry
 * timer would have fifteen timers racing to send the same entries.
 */

const STORAGE_KEY = 'kfless.pending-results.v1';
const TICK_MS = 1_000;

/** Stable empty array, so a snapshot with nothing pending keeps its identity. */
const EMPTY: PendingResult[] = [];

let cache: PendingResult[] = EMPTY;
let loaded = false;
let sending = false;
let timer: ReturnType<typeof setInterval> | null = null;

const listeners = new Set<() => void>();
/** Server rejections, keyed by match. Not persisted — retrying cannot help. */
const rejections = new Map<string, string>();

/** localStorage throws in real situations, e.g. Safari with site data blocked. */
function readStorage(): PendingResult[] {
  try {
    const parsed = parsePending(window.localStorage.getItem(STORAGE_KEY));
    return parsed.length === 0 ? EMPTY : parsed;
  } catch {
    return EMPTY;
  }
}

function writeStorage(list: PendingResult[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, serializePending(list));
  } catch {
    // Storage unavailable. The in-memory queue still retries for this page view.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function setList(next: PendingResult[]): void {
  cache = next.length === 0 ? EMPTY : next;
  writeStorage(cache);
  emit();
}

function getSnapshot(): PendingResult[] {
  if (!loaded) {
    cache = readStorage();
    loaded = true;
  }
  return cache;
}

/** Nothing is pending on the server, so the first paint shows no badge. */
function getServerSnapshot(): PendingResult[] {
  return EMPTY;
}

async function attempt(entry: PendingResult): Promise<void> {
  if (sending) return;
  sending = true;
  emit();

  try {
    const formData = new FormData();
    formData.set('matchId', entry.matchId);
    formData.set('winnerEntryId', entry.winnerEntryId);
    for (const [entryId, score] of Object.entries(entry.scores)) {
      formData.set(`score-${entryId}`, String(score));
    }

    const result = await submitResult({ error: null, notice: null }, formData);

    if (result.error) {
      /*
       * The server answered and said no — not your match, already decided, and
       * so on. Retrying cannot change that, so stop and show why rather than
       * leaving a badge up for ever.
       */
      rejections.set(entry.matchId, result.error);
    } else {
      rejections.delete(entry.matchId);
    }
    setList(removePending(cache, entry.matchId));
  } catch (error) {
    if (isRetryable(error)) {
      setList(markAttempted(cache, entry.matchId, 'No connection'));
    } else {
      rejections.set(
        entry.matchId,
        error instanceof Error ? error.message : 'Could not save',
      );
      setList(removePending(cache, entry.matchId));
    }
  } finally {
    sending = false;
    emit();
  }
}

function pump(): void {
  const due = nextDue(cache, Date.now());
  if (due) void attempt(due);
  else emit(); // keeps the "retrying in Ns" text counting down
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (timer === null) {
    timer = setInterval(() => {
      if (cache.length > 0) pump();
    }, TICK_MS);
    window.addEventListener('online', pump);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      window.removeEventListener('online', pump);
    }
  };
}

export type SubmitPayload = {
  matchId: string;
  winnerEntryId: string;
  scores: Record<string, number>;
};

export function usePendingSubmit(matchId: string) {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const submit = useCallback(
    (payload: SubmitPayload) => {
      rejections.delete(payload.matchId);
      const entry: PendingResult = { ...payload, queuedAt: Date.now(), attempts: 0 };
      setList(upsertPending(cache, entry));
      void attempt(entry);
    },
    [],
  );

  const retryNow = useCallback(() => {
    const entry = cache.find((item) => item.matchId === matchId);
    if (entry) void attempt(entry);
  }, [matchId]);

  const pending = list.find((item) => item.matchId === matchId) ?? null;

  return {
    pending,
    rejected: rejections.get(matchId) ?? null,
    saving: sending,
    submit,
    retryNow,
    /** Everything still unsent, so a page can warn about other matches too. */
    allPending: list,
    nextRetryInMs: pending ? retryDelayMs(pending.attempts) : 0,
  };
}
