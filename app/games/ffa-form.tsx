'use client';

import { useActionState, useState } from 'react';

import { submitFfaResult } from './actions';
import { emptyResultState, type ResultState } from './state';

export type FfaEntry = {
  entryId: string;
  label: string;
  teamColor: string | null;
  placement: number | null;
  rawScore: number | null;
};

/**
 * SPEC.md §6.4: the admin assigns placement 1..N. Move-up/move-down buttons
 * rather than drag-and-drop — dragging on a phone, outdoors, one-handed, with a
 * drink in the other hand is not a serious input method.
 *
 * rawScore is captured and displayed but never orders anything.
 */
export function FfaForm({ matchId, entries }: { matchId: string; entries: FfaEntry[] }) {
  const [state, formAction, pending] = useActionState<ResultState, FormData>(
    submitFfaResult,
    emptyResultState,
  );

  const [order, setOrder] = useState<FfaEntry[]>(() =>
    [...entries].sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99)),
  );

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="matchId" value={matchId} />

      <p className="text-base text-muted">
        Finishing order, first to last. The optional number is a time or a count &mdash; it is
        shown alongside but never used for ordering.
      </p>

      <ol className="flex flex-col gap-2">
        {order.map((entry, index) => (
          <li
            key={entry.entryId}
            className="card-quiet flex items-center gap-2 p-3"
          >
            <span className="w-8 shrink-0 text-lg font-black tabular-nums">{index + 1}</span>
            {entry.teamColor && (
              <span
                aria-hidden
                className="inline-block size-3 shrink-0 rounded-full"
                style={{ backgroundColor: entry.teamColor }}
              />
            )}
            <span className="min-w-0 flex-1 text-base font-semibold">{entry.label}</span>

            <input type="hidden" name={`placement-${entry.entryId}`} value={index + 1} />
            <input
              type="number"
              inputMode="numeric"
              min={0}
              name={`raw-${entry.entryId}`}
              defaultValue={entry.rawScore ?? ''}
              placeholder="—"
              aria-label={`Raw score for ${entry.label}`}
              className="field w-16 shrink-0 px-2"
            />

            <span className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${entry.label} up`}
                className="size-8 rounded border-2 border-ink text-sm font-bold disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === order.length - 1}
                aria-label={`Move ${entry.label} down`}
                className="size-8 rounded border-2 border-ink text-sm font-bold disabled:opacity-30"
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>

      {state.error && (
        <p role="alert" className="card-shout text-base font-bold">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="card-hot text-base font-bold">
          {state.notice}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary h-14 text-lg"
      >
        {pending ? 'Saving…' : 'Save finishing order'}
      </button>
    </form>
  );
}
