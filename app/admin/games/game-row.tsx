'use client';

import { useActionState, useState } from 'react';

import { FORMAT_LABELS, type GameFormat, scoresByWins } from '@/lib/games';

import { deleteGame, scheduleGameAction, unscheduleGameAction } from './actions';
import { GameForm, type GameFormValues } from './game-form';
import { emptyGameState, type GameActionState } from './state';

export type GameRowData = GameFormValues & {
  id: string;
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'COMPLETE';
  entryCount: number;
  matchCount: number;
  completedCount: number;
};

const BUTTON = 'btn';

export function GameRow({ game }: { game: GameRowData }) {
  const [scheduleState, scheduleAction, schedulePending] = useActionState<GameActionState, FormData>(
    scheduleGameAction,
    emptyGameState,
  );
  const [clearState, clearAction, clearPending] = useActionState<GameActionState, FormData>(
    unscheduleGameAction,
    emptyGameState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState<GameActionState, FormData>(
    deleteGame,
    emptyGameState,
  );

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const message =
    scheduleState.error ??
    clearState.error ??
    deleteState.error ??
    scheduleState.notice ??
    clearState.notice ??
    deleteState.notice;

  const hasResults = game.completedCount > 0;

  return (
    <li className="card-quiet flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-black">{game.name}</span>
        <span className={`chip ${game.status === 'COMPLETE' ? 'chip-amber' : 'chip-quiet'}`}>
          {game.status}
        </span>
      </div>

      <p className="text-base text-muted">
        {FORMAT_LABELS[game.format as GameFormat]} &middot; {game.entriesPerTeam} entr
        {game.entriesPerTeam === 1 ? 'y' : 'ies'} per team
        {game.scheduledDay !== null && ` · day ${game.scheduledDay}`}
        {game.station && ` · ${game.station}`}
      </p>

      <p className="text-base tabular-nums text-muted">
        {game.entryCount} entries &middot; {game.matchCount} matches
        {hasResults && ` · ${game.completedCount} played`}
      </p>

      <p className="font-mono text-sm text-muted">
        {scoresByWins(game.format as GameFormat)
          ? game.pointsPerWin === null
            ? 'points per win not set'
            : `${game.pointsPerWin} per win`
          : game.pointsMatrix}
      </p>

      {message && (
        <p role="status" className="card-hot text-base font-bold">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <form action={scheduleAction}>
          <input type="hidden" name="gameId" value={game.id} />
          <button type="submit" disabled={schedulePending} className={BUTTON}>
            {schedulePending
              ? 'Building…'
              : game.matchCount > 0
                ? 'Rebuild bracket'
                : 'Schedule'}
          </button>
        </form>

        {game.matchCount > 0 && (
          <form action={clearAction}>
            <input type="hidden" name="gameId" value={game.id} />
            <button type="submit" disabled={clearPending} className={BUTTON}>
              Clear
            </button>
          </form>
        )}

        <button type="button" onClick={() => setEditing(!editing)} className={BUTTON}>
          {editing ? 'Close' : 'Edit'}
        </button>

        <button
          type="button"
          onClick={() => setConfirmingDelete(!confirmingDelete)}
          className={BUTTON}
        >
          Delete
        </button>
      </div>

      {confirmingDelete && (
        <form action={deleteAction} className="flex flex-col gap-2 border-t-2 border-rule pt-3">
          <input type="hidden" name="gameId" value={game.id} />
          {hasResults ? (
            <>
              <p className="text-base font-semibold">
                {game.name} has {game.completedCount} recorded result
                {game.completedCount === 1 ? '' : 's'}. Type its name to confirm.
              </p>
              <input
                name="confirmName"
                type="text"
                autoComplete="off"
                placeholder={game.name}
                className="field"
              />
            </>
          ) : (
            <p className="text-base">Nothing has been played. Delete it?</p>
          )}
          <button
            type="submit"
            disabled={deletePending}
            className="btn btn-shout w-full"
          >
            {deletePending ? 'Deleting…' : `Delete ${game.name}`}
          </button>
        </form>
      )}

      {editing && (
        <div className="border-t-2 border-rule pt-3">
          <GameForm mode="edit" values={game} />
        </div>
      )}
    </li>
  );
}
