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
    <section className="card flex flex-col gap-3">
      <h2 className="section-title">Admin</h2>
      <p className="text-base text-muted">
        {status === 'COMPLETE'
          ? 'Scored. Editing any result reopens it and drops the scores until you mark it complete again.'
          : outstanding === 0
            ? 'Everything is played. Marking it complete writes the points.'
            : `${outstanding} match${outstanding === 1 ? '' : 'es'} still to play.`}
      </p>

      {message && (
        <p role="status" className="card-hot text-base font-bold">
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
              className="btn btn-primary"
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
                className="btn"
              >
                Rescore
              </button>
            </form>
            <form action={reopenAction}>
              <input type="hidden" name="gameId" value={gameId} />
              <button
                type="submit"
                disabled={reopenPending}
                className="btn"
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
