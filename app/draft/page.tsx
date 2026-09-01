import Link from 'next/link';

import { identify, isAdmin } from '@/lib/auth';
import { loadDraftState } from '@/lib/draft-state';

import { AdminControls } from './admin-controls';
import { PlayerPool } from './player-pool';
import { EmptyState, PageHeader, SectionHeading, TeamMark } from '@/app/ui';

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
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-6">
      {/*
        The status is the kicker and "Draft" is the title, matching the other
        pages — a page whose big heading reads "Not started" does not say where
        you are, and the two-word statuses wrapped the heading onto three lines
        at 390px.
      */}
      <PageHeader
        eyebrow={
          draft.status === 'NOT_STARTED'
            ? 'Not started yet'
            : draft.status === 'LIVE'
              ? draft.paused
                ? 'Paused by the admin'
                : 'On the clock'
              : 'Draft complete'
        }
        title="Draft"
        action={
          <Link href="/" className="btn btn-quiet">
            Home
          </Link>
        }
      />

      <DraftPoller intervalMs={5000} active={draft.status === 'LIVE'} />

      {draft.status === 'LIVE' && onTheClock && (
        <section className="card-hot foam-edge mt-3">
          <p className="eyebrow">
            Pick {onTheClock.pickNumber} of {draft.totalPicks} &middot; Round {onTheClock.round}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <TeamMark
              colorHex={onTheClock.team.colorHex}
              logoUrl={onTheClock.team.logoUrl}
              size={52}
            />
            <div className="min-w-0">
              <p className="display truncate text-2xl">{onTheClock.team.name}</p>
              <p className="text-base text-muted">{onTheClock.team.captainName}</p>
            </div>
          </div>

          {draft.paused && (
            <p className="mt-3 text-base font-black uppercase">Paused — nobody can pick.</p>
          )}

          {!draft.paused && !canPick && (
            <p className="mt-3 text-base font-bold">Waiting on {onTheClock.team.captainName}.</p>
          )}

          {canPick && !isMyClock && admin && (
            <p className="mt-3 text-base font-bold">You&apos;re picking for them as admin.</p>
          )}

          {draft.upcoming.length > 0 && (
            <div className="mt-4 border-t-[3px] border-ink pt-3">
              <p className="eyebrow">Up next</p>
              <ol className="mt-1 flex flex-col gap-0.5">
                {draft.upcoming.map((slot) => (
                  <li key={slot.pickNumber} className="flex justify-between gap-3 text-base">
                    <span>
                      <span
                        aria-hidden
                        className="swatch mr-2 align-middle"
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
        <EmptyState>
          The draft hasn&apos;t started. {draft.totalPicks} picks across {draft.teamCount} teams,
          snake order by draft position. Position 4 gets the last pick &mdash; and Mister
          Irrelevant.
        </EmptyState>
      )}

      {draft.status === 'COMPLETE' && (
        <p className="card text-base font-bold">
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
        <SectionHeading title="Rosters" />
        <ul className="flex flex-col gap-3">
          {draft.teams.map((team) => (
            <li key={team.id} className="card-quiet">
              <div className="flex items-center gap-3">
                <TeamMark colorHex={team.colorHex} logoUrl={team.logoUrl} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-black leading-tight">{team.name}</p>
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
                        <span className="chip chip-quiet ml-2">Captain</span>
                      )}
                      {player.isMisterIrrelevant && (
                        <span className="chip chip-amber ml-2">Mister Irrelevant</span>
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
          <SectionHeading title="Pick history" />
          <ol className="flex flex-col gap-1">
            {draft.history.map((entry) => (
              <li
                key={entry.pickNumber}
                className="flex items-baseline justify-between gap-3 border-b border-rule pb-1 text-base"
              >
                <span>
                  <span className="mr-2 font-black tabular-nums">#{entry.pickNumber}</span>
                  {entry.player.fullName}
                  {entry.player.isMisterIrrelevant && (
                    <span className="chip chip-amber ml-2">Mister Irrelevant</span>
                  )}
                </span>
                <span className="shrink-0 text-muted">
                  <span
                    aria-hidden
                    className="swatch mr-1.5 align-middle"
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
