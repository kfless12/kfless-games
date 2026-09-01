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
      <p className="card-quiet border-dashed text-base text-muted">
        Nothing is queued. Matches appear here the moment a game is scheduled.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {message && (
        <p role="status" className="card-hot text-base font-bold">
          {message}
        </p>
      )}

      {queues.map((queue) => {
        const bumped = [queue.nowPlaying, queue.onDeck, queue.inTheHole, ...queue.waiting].some(
          (match) => match?.queuePosition !== null && match !== null,
        );

        return (
          <section key={queue.station} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b-[3px] border-ink pb-1">
              <h2 className="section-title">{queue.station}</h2>
              {isAdmin && bumped && (
                <form action={dispatch}>
                  <input type="hidden" name="op" value="clear-bumps" />
                  <input type="hidden" name="station" value={queue.station} />
                  <button
                    type="submit"
                    className="text-xs font-black uppercase tracking-wide underline"
                  >
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
              <details className="card-quiet">
                <summary className="cursor-pointer text-sm font-black uppercase tracking-wide">
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
  if (!match) {
    // An empty slot is drawn quietly — a heavy box around nothing pulls the eye
    // to the one thing on the page with no information in it.
    return (
      <li className="card-quiet border-dashed">
        <p className="text-xs font-black uppercase tracking-widest text-muted">
          {SLOT_LABELS[slot]}
        </p>
        <p className="mt-1 text-base text-muted">Nothing yet</p>
      </li>
    );
  }

  const hot = slot === 'NOW_PLAYING';

  return (
    <li className={hot ? 'card-hot' : 'card-quiet'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`chip ${hot ? 'chip-amber' : 'chip-quiet'}`}>{SLOT_LABELS[slot]}</p>
        <p className="text-xs font-bold uppercase tracking-wide text-muted">
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
              <span aria-hidden className="swatch" style={{ backgroundColor: side.teamColor }} />
            )}
            <span className={side.teamId === myTeamId ? 'font-black underline decoration-2' : ''}>
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
            <button type="submit" disabled={pending} className="btn btn-primary">
              Start
            </button>
          </form>
        )}
        {match.status === 'IN_PROGRESS' && canStart && (
          <form action={dispatch}>
            <input type="hidden" name="op" value="unstart" />
            <input type="hidden" name="matchId" value={match.id} />
            <button type="submit" className="btn btn-quiet">
              Not started
            </button>
          </form>
        )}
        <Link href={`/games/${match.gameId}`} className={match.status === 'IN_PROGRESS' ? 'btn btn-shout' : 'btn'}>
          {match.status === 'IN_PROGRESS' ? 'Report result' : 'Open game'}
        </Link>
        {isAdmin && slot !== 'NOW_PLAYING' && match.queuePosition === null && (
          <form action={dispatch}>
            <input type="hidden" name="op" value="bump" />
            <input type="hidden" name="matchId" value={match.id} />
            <button type="submit" className="btn btn-quiet">
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
