'use client';

import { useActionState } from 'react';

import { setStandingsOverride } from '@/app/games/actions';
import { emptyResultState, type ResultState } from '@/app/games/state';

export type OverrideTeam = { id: string; name: string; colorHex: string };
export type ExistingOverride = { teamId: string; priority: number; reason: string };

/**
 * SPEC.md §6.5 tie-breaker 5: the admin's manual override, with a required
 * reason. It only ever decides between teams the first four tie-breakers left
 * level, so saving one for a team that is clearly ahead or behind changes
 * nothing — the board says so rather than letting the admin wonder why.
 */
export function OverrideForm({
  teams,
  existing,
  levelGroups,
}: {
  teams: OverrideTeam[];
  existing: ExistingOverride[];
  /** Team names currently level on points, 1sts and 2nds, one list per group. */
  levelGroups: string[][];
}) {
  const [state, dispatch, pending] = useActionState<ResultState, FormData>(
    setStandingsOverride,
    emptyResultState,
  );

  const teamById = new Map(teams.map((team) => [team.id, team]));
  const message = state.error ?? state.notice;

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="section-title">Tie-breaks</h2>
      <p className="text-base text-muted">
        Points, then 1st places, then 2nd places, then round-robin head-to-head decide the
        table on their own. If two teams are still level after all four, the order you set
        here breaks it &mdash; lower number ranks higher. It has no effect otherwise.
      </p>

      {levelGroups.length > 0 ? (
        <p className="card-hot text-base font-bold">
          Level right now: {levelGroups.map((group) => group.join(' / ')).join('; ')}.
        </p>
      ) : (
        <p className="text-base text-muted">Nobody is level right now.</p>
      )}

      {message && (
        <p role="status" className="card-hot text-base font-bold">
          {message}
        </p>
      )}

      {existing.length > 0 && (
        <ul className="flex flex-col gap-2">
          {existing
            .slice()
            .sort((a, b) => a.priority - b.priority)
            .map((override) => {
              const team = teamById.get(override.teamId);
              return (
                <li key={override.teamId} className="card-quiet flex flex-col gap-2">
                  <span className="flex items-center gap-2 text-base">
                    <span className="w-6 shrink-0 text-center font-black tabular-nums">
                      {override.priority}
                    </span>
                    <span
                      aria-hidden
                      className="swatch"
                      style={{ backgroundColor: team?.colorHex ?? 'transparent' }}
                    />
                    <span className="min-w-0 flex-1 truncate font-bold">
                      {team?.name ?? 'Unknown team'}
                    </span>
                  </span>
                  <span className="text-base">{override.reason}</span>
                  <form action={dispatch}>
                    <input type="hidden" name="teamId" value={override.teamId} />
                    <input type="hidden" name="clear" value="true" />
                    <button type="submit" disabled={pending} className="btn btn-quiet">
                      Remove
                    </button>
                  </form>
                </li>
              );
            })}
        </ul>
      )}

      <form action={dispatch} className="flex flex-col gap-3 border-t-2 border-rule pt-3">
        <label className="flex flex-col gap-1 text-base font-semibold">
          Team
          <select name="teamId" required defaultValue="" className="field">
            <option value="" disabled>
              Pick a team
            </option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-base font-semibold">
          Rank among level teams
          <input
            type="number"
            inputMode="numeric"
            name="priority"
            min={1}
            max={9}
            defaultValue={1}
            required
            className="field w-24"
          />
          <span className="text-sm font-normal text-muted">1 finishes above 2.</span>
        </label>

        <label className="flex flex-col gap-1 text-base font-semibold">
          Reason
          <textarea
            name="reason"
            rows={2}
            maxLength={500}
            required
            placeholder="e.g. Won the dance-off"
            className="field h-auto py-2"
          />
          <span className="text-sm font-normal text-muted">Shown on the table next to the team.</span>
        </label>

        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save tie-break'}
        </button>
      </form>
    </section>
  );
}
