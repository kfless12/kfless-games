'use client';

import { useActionState, useState } from 'react';

import { markGameComplete, reopenGame } from './actions';
import { emptyResultState, type ResultState } from './state';

/** One entry in a group the round-robin tie-breakers could not separate. */
export type TiedEntry = { entryId: string; label: string; teamColor: string | null };

/** SPEC.md §6.5: marking a game complete is what writes game_results. */
export function CompleteControls({
  gameId,
  status,
  outstanding,
  ties = [],
}: {
  gameId: string;
  status: string;
  outstanding: number;
  /**
   * SPEC.md §6.3 tie-breaker 3: groups still level after head-to-head and
   * differential. Each is settled by a coin flip the admin does in the yard
   * and records here. Empty for every format but round robin.
   */
  ties?: TiedEntry[][];
}) {
  const [completeState, completeAction, completePending] = useActionState<ResultState, FormData>(
    markGameComplete,
    emptyResultState,
  );
  const [reopenState, reopenAction, reopenPending] = useActionState<ResultState, FormData>(
    reopenGame,
    emptyResultState,
  );

  /*
   * The order the coin flip produced, one list per tied group. State rather
   * than a drag handle: at 390px, outdoors, "Move up" is a tap target and a
   * drag is a gamble. The lists start in the table's current (arbitrary but
   * stable) order, so submitting without touching them is still a decision —
   * which is why the button is held back until each group has been confirmed.
   */
  const [order, setOrder] = useState<string[][]>(() => ties.map((group) => group.map((t) => t.entryId)));
  const [confirmed, setConfirmed] = useState<boolean[]>(() => ties.map(() => false));

  const labelFor = new Map(ties.flat().map((entry) => [entry.entryId, entry]));
  const needsFlip = status !== 'COMPLETE' && ties.length > 0;
  const allConfirmed = confirmed.every(Boolean);

  function moveUp(groupIndex: number, entryId: string) {
    setOrder((current) =>
      current.map((group, index) => {
        if (index !== groupIndex) return group;
        const at = group.indexOf(entryId);
        if (at <= 0) return group;
        const next = [...group];
        [next[at - 1], next[at]] = [next[at], next[at - 1]];
        return next;
      }),
    );
    setConfirmed((current) => current.map((done, index) => (index === groupIndex ? false : done)));
  }

  const message =
    completeState.error ?? reopenState.error ?? completeState.notice ?? reopenState.notice;

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="section-title">Admin</h2>
      <p className="text-base text-muted">
        {status === 'COMPLETE'
          ? 'Scored. Editing any result reopens it and drops the scores until you mark it complete again.'
          : outstanding > 0
            ? `${outstanding} match${outstanding === 1 ? '' : 'es'} still to play.`
            : needsFlip
              ? 'Everything is played, but the table has a tie the rules cannot break.'
              : 'Everything is played. Marking it complete writes the points.'}
      </p>

      {needsFlip &&
        order.map((group, groupIndex) => (
          <div key={groupIndex} role="group" aria-label="Coin flip" className="card-hot flex flex-col gap-2">
            <p className="text-sm font-black uppercase tracking-widest">
              Coin flip {order.length > 1 ? groupIndex + 1 : ''}
            </p>
            <p className="text-base">
              {group.length} entries are level on wins, head-to-head and differential. Flip for
              it, then put the winner on top.
            </p>
            <ol className="flex flex-col gap-1.5">
              {group.map((entryId, position) => {
                const entry = labelFor.get(entryId);
                return (
                  <li key={entryId} className="flex items-center gap-2 text-base">
                    <span className="w-5 shrink-0 text-center font-black tabular-nums">
                      {position + 1}
                    </span>
                    <span
                      aria-hidden
                      className="swatch"
                      style={{ backgroundColor: entry?.teamColor ?? 'transparent' }}
                    />
                    <span className="min-w-0 flex-1 truncate font-bold">{entry?.label ?? 'Unknown'}</span>
                    <button
                      type="button"
                      onClick={() => moveUp(groupIndex, entryId)}
                      disabled={position === 0}
                      aria-label={`Move ${entry?.label ?? 'entry'} up`}
                      className="btn btn-quiet min-h-[2.5rem] px-3 disabled:opacity-30"
                    >
                      Move up
                    </button>
                  </li>
                );
              })}
            </ol>
            <label className="flex items-center gap-3 text-base font-semibold">
              <input
                type="checkbox"
                className="size-6"
                checked={confirmed[groupIndex] ?? false}
                onChange={(event) =>
                  setConfirmed((current) =>
                    current.map((done, index) => (index === groupIndex ? event.target.checked : done)),
                  )
                }
              />
              This is the order the coin decided
            </label>
          </div>
        ))}

      {message && (
        <p role="status" className="card-hot text-base font-bold">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status !== 'COMPLETE' && (
          <form action={completeAction}>
            <input type="hidden" name="gameId" value={gameId} />
            {needsFlip && (
              <input type="hidden" name="coinFlipOrder" value={order.flat().join(',')} />
            )}
            <button
              type="submit"
              disabled={completePending || (needsFlip && !allConfirmed)}
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
