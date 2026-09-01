'use client';

import { useActionState } from 'react';

import { markGameComplete, reopenGame } from './actions';
import { emptyResultState, type ResultState } from './state';

/** SPEC.md §6.5: marking a game complete is what writes game_results. */
export function CompleteControls({
  gameId,
  status,
  outstanding,
}: {
  gameId: string;
  status: string;
  outstanding: number;
}) {
  const [completeState, completeAction, completePending] = useActionState<ResultState, FormData>(
    markGameComplete,
    emptyResultState,
  );
  const [reopenState, reopenAction, reopenPending] = useActionState<ResultState, FormData>(
    reopenGame,
    emptyResultState,
  );

  const message =
    completeState.error ?? reopenState.error ?? completeState.notice ?? reopenState.notice;

  return (
    <section className="flex flex-col gap-3 rounded-lg border-2 border-ink p-4">
      <h2 className="text-lg font-black uppercase tracking-wide">Admin</h2>
      <p className="text-base text-muted">
        {status === 'COMPLETE'
          ? 'Scored. Editing any result reopens it and drops the scores until you mark it complete again.'
          : outstanding === 0
            ? 'Everything is played. Marking it complete writes the points.'
            : `${outstanding} match${outstanding === 1 ? '' : 'es'} still to play.`}
      </p>

      {message && (
        <p role="status" className="rounded-lg border-2 border-rule p-3 text-base font-semibold">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status !== 'COMPLETE' && (
          <form action={completeAction}>
            <input type="hidden" name="gameId" value={gameId} />
            <button
              type="submit"
              disabled={completePending}
              className="h-12 rounded-lg bg-ink px-5 text-base font-bold text-paper disabled:opacity-50"
            >
              {completePending ? 'Scoring…' : 'Mark complete & score'}
            </button>
          </form>
        )}
        {status === 'COMPLETE' && (
          <>
            <form action={completeAction}>
              <input type="hidden" name="gameId" value={gameId} />
              <button
                type="submit"
                disabled={completePending}
                className="h-12 rounded-lg border-2 border-ink px-4 text-base font-bold disabled:opacity-50"
              >
                Rescore
              </button>
            </form>
            <form action={reopenAction}>
              <input type="hidden" name="gameId" value={gameId} />
              <button
                type="submit"
                disabled={reopenPending}
                className="h-12 rounded-lg border-2 border-ink px-4 text-base font-bold disabled:opacity-50"
              >
                Reopen
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
