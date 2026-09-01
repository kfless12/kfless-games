'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import type { QueueMatch, QueueSlotName, StationQueue } from '@/lib/queue';

import { queueAction } from './actions';
import { emptyQueueState, type QueueActionState } from './state';

const SLOT_LABELS: Record<QueueSlotName, string> = {
  NOW_PLAYING: 'Now playing',
  ON_DECK: 'On deck',
  IN_THE_HOLE: 'In the hole',
};

export function QueueView({
  queues,
  myTeamId,
  canStart,
  isAdmin,
}: {
  queues: StationQueue[];
  myTeamId: string | null;
  /** Match ids this viewer may start. Server re-checks regardless. */
  canStart: string[];
  isAdmin: boolean;
}) {
  const [state, dispatch, pending] = useActionState<QueueActionState, FormData>(
    queueAction,
    emptyQueueState,
  );

  const message = state.error ?? state.notice;

  if (queues.length === 0) {
    return (
      <p className="rounded-lg border-2 border-rule p-4 text-base">
        Nothing is queued. A game has to be scheduled before its matches appear here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {message && (
        <p role="status" className="rounded-lg border-2 border-rule p-3 text-base font-semibold">
          {message}
        </p>
      )}

      {queues.map((queue) => {
        const bumped = [queue.nowPlaying, queue.onDeck, queue.inTheHole, ...queue.waiting].some(
          (match) => match?.queuePosition !== null && match !== null,
        );

        return (
          <section key={queue.station} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-bold">{queue.station}</h2>
              {isAdmin && bumped && (
                <form action={dispatch}>
                  <input type="hidden" name="op" value="clear-bumps" />
                  <input type="hidden" name="station" value={queue.station} />
                  <button type="submit" className="text-sm font-bold underline">
                    Clear bumps
                  </button>
                </form>
              )}
            </div>

            <ul className="flex flex-col gap-2">
              {(
                [
                  ['NOW_PLAYING', queue.nowPlaying],
                  ['ON_DECK', queue.onDeck],
                  ['IN_THE_HOLE', queue.inTheHole],
                ] as const
              ).map(([slot, match]) => (
                <QueueRow
                  key={slot}
                  slot={slot}
                  match={match}
                  myTeamId={myTeamId}
                  canStart={match ? canStart.includes(match.id) : false}
                  isAdmin={isAdmin}
                  dispatch={dispatch}
                  pending={pending}
                />
              ))}
            </ul>

            {queue.waiting.length > 0 && (
              <details className="rounded-lg border-2 border-rule p-3">
                <summary className="cursor-pointer text-base font-semibold">
                  {queue.waiting.length} more waiting
                </summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {queue.waiting.map((match) => (
                    <li key={match.id} className="flex items-baseline justify-between gap-3 text-base">
                      <span className={mine(match, myTeamId) ? 'font-bold' : ''}>
                        {describeSides(match)}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-sm text-muted">{roundLabel(match)}</span>
                        {isAdmin && (
                          <form action={dispatch}>
                            <input type="hidden" name="op" value="bump" />
                            <input type="hidden" name="matchId" value={match.id} />
                            <button type="submit" className="text-sm font-bold underline">
                              Bump
                            </button>
                          </form>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}

function QueueRow({
  slot,
  match,
  myTeamId,
  canStart,
  isAdmin,
  dispatch,
  pending,
}: {
  slot: QueueSlotName;
  match: QueueMatch | null;
  myTeamId: string | null;
  canStart: boolean;
  isAdmin: boolean;
  dispatch: (formData: FormData) => void;
  pending: boolean;
}) {
  const emphasis = slot === 'NOW_PLAYING' ? 'border-ink border-4' : 'border-rule border-2';

  if (!match) {
    return (
      <li className={`rounded-lg ${emphasis} p-4 opacity-60`}>
        <p className="text-sm font-bold uppercase tracking-widest text-muted">
          {SLOT_LABELS[slot]}
        </p>
        <p className="mt-1 text-base text-muted">Nothing yet</p>
      </li>
    );
  }

  return (
    <li className={`rounded-lg ${emphasis} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold uppercase tracking-widest text-muted">
          {SLOT_LABELS[slot]}
        </p>
        <p className="text-sm text-muted">
          {match.gameName} &middot; {roundLabel(match)}
          {match.queuePosition !== null && ' · bumped'}
        </p>
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        {match.sides.map((side, index) => (
          <li
            key={side.entryId ?? index}
            className="flex items-center gap-2 text-lg"
          >
            {side.teamColor && (
              <span
                aria-hidden
                className="inline-block size-3 shrink-0 rounded-full"
                style={{ backgroundColor: side.teamColor }}
              />
            )}
            <span className={side.teamId === myTeamId ? 'font-black' : ''}>
              {side.label ?? <span className="text-muted">Waiting…</span>}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        {/* Only the on-deck row offers Start; the action enforces it too. */}
        {match.status === 'READY' && canStart && slot === 'ON_DECK' && (
          <form action={dispatch}>
            <input type="hidden" name="op" value="start" />
            <input type="hidden" name="matchId" value={match.id} />
            <button
              type="submit"
              disabled={pending}
              className="h-11 rounded-lg bg-ink px-4 text-base font-bold text-paper disabled:opacity-50"
            >
              Start
            </button>
          </form>
        )}
        {match.status === 'IN_PROGRESS' && canStart && (
          <form action={dispatch}>
            <input type="hidden" name="op" value="unstart" />
            <input type="hidden" name="matchId" value={match.id} />
            <button type="submit" className="h-11 rounded-lg border-2 border-rule px-4 text-base font-bold">
              Not started
            </button>
          </form>
        )}
        <Link
          href={`/games/${match.gameId}`}
          className="flex h-11 items-center rounded-lg border-2 border-ink px-4 text-base font-bold"
        >
          {match.status === 'IN_PROGRESS' ? 'Report result' : 'Open game'}
        </Link>
        {isAdmin && slot !== 'NOW_PLAYING' && match.queuePosition === null && (
          <form action={dispatch}>
            <input type="hidden" name="op" value="bump" />
            <input type="hidden" name="matchId" value={match.id} />
            <button type="submit" className="h-11 rounded-lg border-2 border-rule px-4 text-base font-bold">
              Bump
            </button>
          </form>
        )}
      </div>
    </li>
  );
}

function mine(match: QueueMatch, teamId: string | null): boolean {
  return teamId !== null && match.sides.some((side) => side.teamId === teamId);
}

function describeSides(match: QueueMatch): string {
  return match.sides.map((side) => side.label ?? 'Waiting…').join(' v ');
}

function roundLabel(match: QueueMatch): string {
  const bracket =
    match.bracket === 'WINNERS'
      ? 'Winners'
      : match.bracket === 'LOSERS'
        ? 'Losers'
        : match.bracket === 'GRAND_FINAL'
          ? 'Grand final'
          : match.bracket === 'RR'
            ? 'Round'
            : 'Heat';
  return `${bracket} ${match.round}`;
}
