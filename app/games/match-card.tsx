'use client';

import { useActionState, useState } from 'react';

import { submitResult, undoResult } from './actions';
import { emptyResultState, type ResultState } from './state';

export type MatchSide = {
  entryId: string | null;
  label: string | null;
  teamName: string | null;
  teamColor: string | null;
  score: number | null;
  isWinner: boolean | null;
};

export type MatchCardData = {
  id: string;
  bracket: string;
  round: number;
  slot: number;
  status: string;
  station: string | null;
  sides: MatchSide[];
};

/**
 * One match, with result entry when the viewer is allowed to report it.
 *
 * `canReport` only decides what renders. lib/engine/submit.ts re-checks on the
 * server — SPEC.md §8 names who may submit, and a hidden button is not a
 * control.
 */
export function MatchCard({
  match,
  canReport,
  label,
}: {
  match: MatchCardData;
  canReport: boolean;
  label: string;
}) {
  const [state, formAction, pending] = useActionState<ResultState, FormData>(
    submitResult,
    emptyResultState,
  );
  const [undoState, undoAction, undoPending] = useActionState<ResultState, FormData>(
    undoResult,
    emptyResultState,
  );
  const [editing, setEditing] = useState(false);

  const complete = match.status === 'COMPLETE';
  const playable = match.sides.every((side) => side.entryId !== null);
  const message = state.error ?? undoState.error ?? state.notice ?? undoState.notice;

  return (
    <li className="flex flex-col gap-3 rounded-lg border-2 border-rule p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold uppercase tracking-wide text-muted">{label}</span>
        <span className="text-sm font-bold uppercase tracking-wide text-muted">
          {complete ? 'Final' : playable ? 'Ready' : 'Waiting'}
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {match.sides.map((side, index) => (
          <li
            key={side.entryId ?? `empty-${index}`}
            className="flex items-center justify-between gap-3 text-base"
          >
            <span className="flex min-w-0 items-center gap-2">
              {side.teamColor && (
                <span
                  aria-hidden
                  className="inline-block size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: side.teamColor }}
                />
              )}
              <span className={side.isWinner ? 'font-black' : ''}>
                {side.label ?? <span className="text-muted">Waiting…</span>}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 tabular-nums">
              {side.score !== null && <span className="font-bold">{side.score}</span>}
              {side.isWinner && <span aria-label="winner">✓</span>}
            </span>
          </li>
        ))}
      </ul>

      {message && (
        <p role="status" className="rounded-lg border-2 border-rule p-3 text-base font-semibold">
          {message}
        </p>
      )}

      {canReport && playable && (complete ? editing : true) && (
        <form action={formAction} className="flex flex-col gap-3 border-t-2 border-rule pt-3">
          <input type="hidden" name="matchId" value={match.id} />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-base font-semibold">Who won?</legend>
            {match.sides.map((side) =>
              side.entryId ? (
                <label key={side.entryId} className="flex items-center gap-3 text-base">
                  <input
                    type="radio"
                    name="winnerEntryId"
                    value={side.entryId}
                    defaultChecked={side.isWinner === true}
                    required
                    className="size-6"
                  />
                  <span className="flex-1">{side.label}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={999}
                    name={`score-${side.entryId}`}
                    defaultValue={side.score ?? ''}
                    placeholder="cups"
                    aria-label={`Score for ${side.label}`}
                    className="h-11 w-20 rounded-lg border-2 border-rule px-2 text-base"
                  />
                </label>
              ) : null,
            )}
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending}
              className="h-12 flex-1 rounded-lg bg-ink text-base font-bold text-paper disabled:opacity-50"
            >
              {pending ? 'Saving…' : complete ? 'Save change' : 'Save result'}
            </button>
            {complete && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-12 rounded-lg border-2 border-rule px-4 text-base font-bold"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {canReport && complete && !editing && (
        <div className="flex flex-wrap gap-2 border-t-2 border-rule pt-3">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="h-11 rounded-lg border-2 border-ink px-4 text-base font-bold"
          >
            Change result
          </button>
          <form action={undoAction}>
            <input type="hidden" name="matchId" value={match.id} />
            <button
              type="submit"
              disabled={undoPending}
              className="h-11 rounded-lg border-2 border-ink px-4 text-base font-bold disabled:opacity-50"
            >
              {undoPending ? 'Undoing…' : 'Undo'}
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
