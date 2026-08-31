'use client';

import { useActionState, useMemo, useState } from 'react';

import type { DraftPlayer } from '@/lib/draft-state';
import { RATING_FIELDS } from '@/lib/profile';

import { makePick } from './actions';
import { type DraftActionState, emptyDraftState } from './state';

type SortKey = 'name' | 'overall' | (typeof RATING_FIELDS)[number]['key'];

function overall(player: DraftPlayer): number {
  const values = RATING_FIELDS.map(({ key }) => player.ratings[key]).filter(
    (v): v is number => typeof v === 'number',
  );
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * The player pool. SPEC.md §5.3: searchable, sortable cards showing photo,
 * name, nickname, and scouting ratings.
 *
 * `canPick` only controls whether the button renders. The action re-checks on
 * the server — SPEC.md §5.2 is explicit that the UI is not the control.
 */
export function PlayerPool({
  pool,
  canPick,
  pickingFor,
}: {
  pool: DraftPlayer[];
  canPick: boolean;
  pickingFor: string | null;
}) {
  const [state, formAction, pending] = useActionState<DraftActionState, FormData>(
    makePick,
    emptyDraftState,
  );
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('overall');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? pool.filter(
          (p) =>
            p.fullName.toLowerCase().includes(needle) ||
            (p.nickname ?? '').toLowerCase().includes(needle) ||
            (p.hometown ?? '').toLowerCase().includes(needle),
        )
      : pool;

    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.fullName.localeCompare(b.fullName);
      if (sort === 'overall') return overall(b) - overall(a);
      return (b.ratings[sort] ?? -1) - (a.ratings[sort] ?? -1);
    });
  }, [pool, query, sort]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold">Available ({pool.length})</h2>
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg border-2 border-ink p-3 text-base font-semibold">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="rounded-lg border-2 border-rule p-3 text-base font-semibold">
          {state.notice}
        </p>
      )}

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search name, nickname, hometown"
        aria-label="Search the player pool"
        className="h-12 rounded-lg border-2 border-rule px-3 text-base"
      />

      <label className="flex items-center gap-2 text-base">
        <span className="font-semibold">Sort by</span>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          className="h-11 flex-1 rounded-lg border-2 border-rule px-2 text-base"
        >
          <option value="overall">Overall (self-reported)</option>
          <option value="name">Name</option>
          {RATING_FIELDS.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {shown.length === 0 && (
        <p className="text-base text-muted">
          {pool.length === 0 ? 'Everyone has been drafted.' : 'Nobody matches that.'}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {shown.map((player) => (
          <li key={player.id} className="rounded-lg border-2 border-rule p-4">
            <div className="flex items-start gap-3">
              {player.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={player.photoUrl}
                  alt=""
                  className="size-16 shrink-0 rounded-full border-2 border-rule object-cover"
                />
              ) : (
                <div aria-hidden className="size-16 shrink-0 rounded-full border-2 border-dashed border-rule" />
              )}

              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold leading-tight">{player.fullName}</p>
                {player.nickname && (
                  <p className="text-base text-muted">&ldquo;{player.nickname}&rdquo;</p>
                )}
                <p className="mt-1 text-base font-bold tabular-nums">{overall(player)} OVR</p>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {RATING_FIELDS.map(({ key, label }) => (
                <div key={key} className="flex justify-between gap-2 border-b border-rule pb-0.5">
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-bold tabular-nums">{player.ratings[key] ?? '—'}</dd>
                </div>
              ))}
            </dl>

            {player.scoutingReport && (
              <p className="mt-3 text-base italic text-muted">{player.scoutingReport}</p>
            )}

            {canPick && (
              <form action={formAction} className="mt-3">
                <input type="hidden" name="playerId" value={player.id} />
                <button
                  type="submit"
                  disabled={pending}
                  className="h-12 w-full rounded-lg bg-ink text-lg font-black uppercase tracking-wide text-paper disabled:opacity-50"
                >
                  {pending ? 'Drafting…' : `Draft${pickingFor ? ` to ${pickingFor}` : ''}`}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
