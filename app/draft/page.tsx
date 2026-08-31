import Link from 'next/link';

import { identify, isAdmin } from '@/lib/auth';
import { loadDraftState } from '@/lib/draft-state';

import { AdminControls } from './admin-controls';
import { PlayerPool } from './player-pool';
import { DraftPoller } from './poller';

export const dynamic = 'force-dynamic';

/** SPEC.md §5.3. Public and read-only for anyone without a cookie (§3.4). */
export default async function DraftPage() {
  const [identity, draft] = await Promise.all([identify(), loadDraftState()]);

  const admin = isAdmin(identity);
  const onTheClock = draft.onTheClock;

  // A captain may pick only on their own clock. The admin may pick for whoever
  // is on the clock. Cosmetic — actions.ts re-checks this (SPEC.md §5.2).
  const isMyClock = Boolean(
    identity && onTheClock && identity.personId === onTheClock.team.captainId,
  );
  const canPick =
    draft.status === 'LIVE' && !draft.paused && Boolean(onTheClock) && (isMyClock || admin);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-5 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-muted">Draft</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">
            {draft.status === 'NOT_STARTED' && 'Not started'}
            {draft.status === 'LIVE' && (draft.paused ? 'Paused' : 'On the clock')}
            {draft.status === 'COMPLETE' && 'Complete'}
          </h1>
        </div>
        <Link href="/" className="text-base font-bold underline">
          Home
        </Link>
      </header>

      <DraftPoller intervalMs={5000} active={draft.status === 'LIVE'} />

      {draft.status === 'LIVE' && onTheClock && (
        <section
          className="rounded-lg border-4 p-5"
          style={{ borderColor: onTheClock.team.colorHex }}
        >
          <p className="text-sm font-bold uppercase tracking-widest text-muted">
            Pick {onTheClock.pickNumber} of {draft.totalPicks} &middot; Round {onTheClock.round}
          </p>
          <div className="mt-2 flex items-center gap-3">
            {onTheClock.team.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={onTheClock.team.logoUrl}
                alt=""
                className="size-12 shrink-0 rounded-lg border-2 border-rule object-cover"
              />
            ) : null}
            <div>
              <p className="text-2xl font-black leading-tight">{onTheClock.team.name}</p>
              <p className="text-base text-muted">{onTheClock.team.captainName}</p>
            </div>
          </div>

          {draft.paused && (
            <p className="mt-3 text-base font-bold">Paused — nobody can pick right now.</p>
          )}

          {!draft.paused && !canPick && (
            <p className="mt-3 text-base font-semibold">
              Waiting on {onTheClock.team.captainName}.
            </p>
          )}

          {canPick && !isMyClock && admin && (
            <p className="mt-3 text-base font-semibold">
              You&apos;re picking for them as admin.
            </p>
          )}

          {draft.upcoming.length > 0 && (
            <div className="mt-4 border-t-2 border-rule pt-3">
              <p className="text-sm font-bold uppercase tracking-widest text-muted">Up next</p>
              <ol className="mt-1 flex flex-col gap-0.5">
                {draft.upcoming.map((slot) => (
                  <li key={slot.pickNumber} className="flex justify-between gap-3 text-base">
                    <span>
                      <span
                        aria-hidden
                        className="mr-2 inline-block size-3 rounded-full align-middle"
                        style={{ backgroundColor: slot.team.colorHex }}
                      />
                      {slot.team.name}
                    </span>
                    <span className="tabular-nums text-muted">Pick {slot.pickNumber}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {draft.status === 'NOT_STARTED' && (
        <p className="rounded-lg border-2 border-rule p-4 text-base">
          The draft hasn&apos;t started. {draft.totalPicks} picks across {draft.teamCount} teams,
          snake order by draft position.
        </p>
      )}

      {draft.status === 'COMPLETE' && (
        <p className="rounded-lg border-2 border-ink p-4 text-base font-semibold">
          All {draft.totalPicks} picks are in. Rosters are final.
        </p>
      )}

      {admin && (
        <AdminControls
          status={draft.status}
          paused={draft.paused}
          picksMade={draft.picksMade}
          totalPicks={draft.totalPicks}
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Rosters</h2>
        <ul className="flex flex-col gap-3">
          {draft.teams.map((team) => (
            <li key={team.id} className="rounded-lg border-2 border-rule p-4">
              <div className="flex items-center gap-3">
                {team.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={team.logoUrl}
                    alt=""
                    className="size-10 shrink-0 rounded-lg border-2 border-rule object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="inline-block size-5 shrink-0 rounded-full border border-rule"
                    style={{ backgroundColor: team.colorHex }}
                  />
                )}
                <div className="flex-1">
                  <p className="text-lg font-bold leading-tight">{team.name}</p>
                  <p className="text-sm text-muted">
                    Pick {team.draftPosition} &middot; {team.roster.length} player
                    {team.roster.length === 1 ? '' : 's'}
                    {team.picksRemaining > 0 && ` · ${team.picksRemaining} to come`}
                  </p>
                </div>
              </div>
              <ol className="mt-2 flex flex-col gap-0.5">
                {team.roster.map((player) => (
                  <li key={player.id} className="flex justify-between gap-3 text-base">
                    <span>
                      {player.fullName}
                      {player.isCaptain && (
                        <span className="ml-2 text-sm font-bold uppercase text-muted">
                          Captain
                        </span>
                      )}
                      {player.isMisterIrrelevant && (
                        <span className="ml-2 text-sm font-bold uppercase">
                          Mister Irrelevant
                        </span>
                      )}
                    </span>
                    {player.draftPickNumber && (
                      <span className="tabular-nums text-muted">#{player.draftPickNumber}</span>
                    )}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </section>

      <PlayerPool
        pool={draft.pool}
        canPick={canPick}
        pickingFor={canPick && onTheClock ? onTheClock.team.name : null}
      />

      {draft.history.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">Pick history</h2>
          <ol className="flex flex-col gap-1">
            {draft.history.map((entry) => (
              <li
                key={entry.pickNumber}
                className="flex items-baseline justify-between gap-3 border-b border-rule pb-1 text-base"
              >
                <span>
                  <span className="mr-2 font-bold tabular-nums">#{entry.pickNumber}</span>
                  {entry.player.fullName}
                  {entry.player.isMisterIrrelevant && (
                    <span className="ml-2 text-sm font-bold uppercase">Mister Irrelevant</span>
                  )}
                </span>
                <span className="shrink-0 text-muted">
                  <span
                    aria-hidden
                    className="mr-1.5 inline-block size-3 rounded-full align-middle"
                    style={{ backgroundColor: entry.teamColor }}
                  />
                  {entry.teamName}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
