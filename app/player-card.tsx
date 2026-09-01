import Link from 'next/link';

import { RATING_FIELDS, RATING_MAX, TEXT_FIELDS } from '@/lib/profile';

import { TeamMark } from './ui';

/*
 * The read-only draft card. SPEC.md §5.3 wants the pool to show "photo, name,
 * nickname, and scouting ratings"; this is the same card at full size, reachable
 * for any player at any point in the weekend rather than only while they are
 * undrafted. Public per SPEC.md §3.4.
 *
 * Ratings render as bars because they are self-reported and decorative
 * (CLAUDE.md invariant 7) — a bar reads as bragging, a precise number reads as
 * data that feeds something. It does not feed anything.
 */

export type PlayerCardPlayer = {
  id: string;
  fullName: string;
  nickname: string | null;
  photoUrl: string | null;
  isCaptain: boolean;
  isMisterIrrelevant: boolean;
  draftPickNumber: number | null;
  weight: number | null;
  personalRecordBeers: number | null;
  scoutingReport: string | null;
} & Record<string, unknown>;

export type PlayerCardTeam = {
  id: string;
  name: string;
  colorHex: string;
  logoUrl: string | null;
} | null;

function ratingOf(player: PlayerCardPlayer, key: string): number | null {
  const value = player[key];
  return typeof value === 'number' ? value : null;
}

function textOf(player: PlayerCardPlayer, key: string): string | null {
  const value = player[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function PlayerCard({
  player,
  team,
  showTeamLink = true,
}: {
  player: PlayerCardPlayer;
  team: PlayerCardTeam;
  showTeamLink?: boolean;
}) {
  const facts: { label: string; value: string }[] = [
    // The nickname is already shown under the name, so it would repeat here.
    ...TEXT_FIELDS.filter(({ key }) => key !== 'nickname').map(({ key, label }) => ({
      label: label as string,
      value: textOf(player, key),
    })),
    { label: 'Weight', value: player.weight === null ? null : `${player.weight} lb` },
    {
      label: 'Personal record',
      value:
        player.personalRecordBeers === null ? null : `${player.personalRecordBeers} beers`,
    },
  ].filter((fact): fact is { label: string; value: string } => fact.value !== null);

  const ratings = RATING_FIELDS.map(({ key, label }) => ({
    label,
    value: ratingOf(player, key),
  }));
  const rated = ratings.filter((rating) => rating.value !== null);

  return (
    <div className="flex flex-col gap-5">
      <section className="card flex flex-col gap-3">
        <div className="flex items-start gap-3">
          {player.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={player.photoUrl} alt="" className="team-logo size-20 rounded-full" />
          ) : (
            <div
              aria-hidden
              className="size-20 shrink-0 rounded-full border-2 border-dashed border-rule"
            />
          )}

          <div className="min-w-0 flex-1">
            <p className="text-xl font-black leading-tight">{player.fullName}</p>
            {player.nickname && (
              <p className="text-base text-muted">&ldquo;{player.nickname}&rdquo;</p>
            )}

            <p className="mt-2 flex flex-wrap gap-1.5">
              {player.isCaptain && <span className="chip chip-quiet">Captain</span>}
              {player.draftPickNumber !== null && (
                <span className="chip chip-quiet">Pick #{player.draftPickNumber}</span>
              )}
              {player.isMisterIrrelevant && (
                <span className="chip chip-amber">Mister Irrelevant</span>
              )}
            </p>
          </div>
        </div>

        {team &&
          (showTeamLink ? (
            <Link href={`/teams/${team.id}`} className="flex items-center gap-2 font-bold underline">
              <TeamMark colorHex={team.colorHex} logoUrl={team.logoUrl} size={28} />
              {team.name}
            </Link>
          ) : (
            <p className="flex items-center gap-2 font-bold">
              <TeamMark colorHex={team.colorHex} logoUrl={team.logoUrl} size={28} />
              {team.name}
            </p>
          ))}

        {!team && <p className="text-base text-muted">Not drafted yet.</p>}
      </section>

      {player.scoutingReport && (
        <section className="card-hot">
          <p className="eyebrow">Scouting report</p>
          <p className="mt-1 text-base italic">{player.scoutingReport}</p>
        </section>
      )}

      {facts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="section-title">The basics</h2>
          <dl className="card-quiet flex flex-col gap-1">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="flex items-baseline justify-between gap-3 border-b border-rule pb-1 last:border-b-0 last:pb-0"
              >
                <dt className="text-muted">{fact.label}</dt>
                <dd className="text-right font-bold">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="section-title">Self-reported ratings</h2>
        {rated.length === 0 ? (
          <p className="card-quiet text-base text-muted">
            No ratings filled in yet.
          </p>
        ) : (
          <dl className="card-quiet flex flex-col gap-2">
            {ratings.map((rating) => (
              <div key={rating.label} className="flex items-center gap-3">
                <dt className="w-24 shrink-0 text-sm text-muted">{rating.label}</dt>
                <dd className="flex flex-1 items-center gap-2">
                  <span
                    aria-hidden
                    className="h-3 flex-1 overflow-hidden rounded-full border-2 border-ink bg-paper"
                  >
                    <span
                      className="block h-full bg-amber-bright"
                      style={{
                        width: `${Math.round(((rating.value ?? 0) / RATING_MAX) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right text-sm font-bold tabular-nums">
                    {rating.value ?? '—'}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-sm text-muted">
          Self-reported and purely for bragging rights. They do not affect scoring, seeding or
          matchmaking.
        </p>
      </section>
    </div>
  );
}
