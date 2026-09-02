'use client';

import { useActionState } from 'react';

import { saveLineup } from './actions';
import { emptyLineupState, type LineupState } from './state';

export type LineupPlayer = { id: string; fullName: string; nickname: string | null };

export type LineupEntry = {
  id: string;
  label: string;
  shortLabel: string;
  playerIds: string[];
};

/**
 * One entry's lineup. Checkboxes rather than a pair of dropdowns: an entry may
 * be partly filled or empty (SPEC.md §4.4 makes it optional), and dropdowns
 * would need a blank option per slot to express that.
 */
export function EntryForm({
  entry,
  roster,
  entrySize,
}: {
  entry: LineupEntry;
  roster: LineupPlayer[];
  entrySize: number | null;
}) {
  const [state, formAction, pending] = useActionState<LineupState, FormData>(
    saveLineup,
    emptyLineupState,
  );

  const message = state.error ?? state.notice;

  return (
    <li className="card-quiet flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-black">{entry.label}</span>
        <span className="chip chip-quiet">{entry.shortLabel}</span>
      </div>

      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="entryId" value={entry.id} />

        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Players for {entry.label}</legend>
          {roster.map((player) => (
            <label key={player.id} className="flex min-h-11 items-center gap-3 text-base">
              <input
                type="checkbox"
                name="playerId"
                value={player.id}
                defaultChecked={entry.playerIds.includes(player.id)}
                className="size-5 shrink-0 accent-[var(--amber)]"
              />
              <span className="min-w-0 flex-1">
                {player.fullName}
                {player.nickname && (
                  <span className="text-muted"> &ldquo;{player.nickname}&rdquo;</span>
                )}
              </span>
            </label>
          ))}
        </fieldset>

        {entrySize !== null && (
          <p className="text-sm text-muted">
            {entrySize} player{entrySize === 1 ? '' : 's'} per entry. Fewer is fine.
          </p>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary w-full">
          {pending ? 'Saving…' : 'Save lineup'}
        </button>

        {message && (
          <p
            role={state.error ? 'alert' : 'status'}
            className={`text-base font-bold ${state.error ? 'text-amber' : ''}`}
          >
            {message}
          </p>
        )}
      </form>
    </li>
  );
}
