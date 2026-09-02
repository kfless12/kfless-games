import type { MatchCardData } from './match-card';

/*
 * The bracket. SPEC.md §11 names this as the hard case and prescribes the
 * approach: "use horizontal scroll with a sticky round header rather than trying
 * to fit 8 entries on a phone screen."
 *
 * So: rounds are columns, the column headers stick to the top of the scroller,
 * and the whole thing scrolls sideways inside its own box — the page itself
 * never scrolls horizontally. Winners, losers and the grand final are separate
 * scrollers, because stacking three brackets into one grid at 390px produces
 * something nobody can read.
 *
 * No connector lines. At this width they would either be hairlines nobody can
 * see in sunlight or they would crowd out the names, and the names are the
 * information. Position in the column plus the bolded winner carries it.
 */

type Column = { round: number; label: string; matches: MatchCardData[] };

/*
 * Bracket cells use the short entry form (SPEC.md §7.4) — "T1 Kevin/Jake", or
 * "T1-A" before a captain assigns anyone. A full label reads "Team Three — B",
 * which does not fit a column at 390px and truncates to "Team Three …",
 * dropping the half that tells the two entries apart. Full labels stay on the
 * placings list and the match cards below.
 */

const BRACKET_TITLES: Record<string, string> = {
  WINNERS: 'Winners bracket',
  LOSERS: 'Losers bracket',
  GRAND_FINAL: 'Grand final',
};

function roundLabel(bracket: string, round: number, lastRound: number): string {
  if (bracket === 'GRAND_FINAL') return round === 2 ? 'Reset' : 'Final';
  if (bracket === 'WINNERS' && round === lastRound) return 'W final';
  if (bracket === 'LOSERS' && round === lastRound) return 'L final';
  return `Round ${round}`;
}

export function BracketView({ matches }: { matches: MatchCardData[] }) {
  const brackets = ['WINNERS', 'LOSERS', 'GRAND_FINAL'].filter((bracket) =>
    matches.some((match) => match.bracket === bracket),
  );

  if (brackets.length === 0) return null;

  return (
    <div className="flex flex-col gap-5">
      {brackets.map((bracket) => {
        const inBracket = matches.filter((match) => match.bracket === bracket);
        const lastRound = Math.max(...inBracket.map((match) => match.round));

        const columns: Column[] = [...new Set(inBracket.map((match) => match.round))]
          .sort((a, b) => a - b)
          .map((round) => ({
            round,
            label: roundLabel(bracket, round, lastRound),
            matches: inBracket
              .filter((match) => match.round === round)
              .sort((a, b) => a.slot - b.slot),
          }));

        return (
          <section key={bracket} className="flex flex-col gap-2">
            <h3 className="text-base font-black uppercase tracking-wide text-amber">
              {BRACKET_TITLES[bracket] ?? bracket}
            </h3>

            {/*
              The scroller. overflow-x here rather than on the page, so the body
              never scrolls sideways (SPEC.md §11).
            */}
            <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-2">
              <div className="flex min-w-max gap-3">
                {columns.map((column) => (
                  <div key={column.round} className="flex w-[13rem] flex-col gap-2">
                    {/* Sticky round header, per SPEC.md §11. */}
                    <div className="sticky top-0 z-10 rounded-md border-2 border-ink bg-amber-bright px-2 py-1 text-center text-xs font-black uppercase tracking-wider">
                      {column.label}
                    </div>
                    {column.matches.map((match) => (
                      <BracketCell key={match.id} match={match} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BracketCell({ match }: { match: MatchCardData }) {
  const decided = match.status === 'COMPLETE';
  const live = match.status === 'IN_PROGRESS';

  /*
   * The grand-final reset only happens if the losers-bracket side wins the
   * grand final. When it has not activated it has no participants, so it is
   * shown as "not needed" rather than "waiting" — a completed bracket showing a
   * match still waiting reads as an unfinished game.
   */
  const filled = match.sides.filter((side) => side.entryId !== null).length;
  const isReset = match.bracket === 'GRAND_FINAL' && match.round === 2;
  const dormantReset = isReset && filled === 0 && !decided;

  return (
    <div
      className={`rounded-md border-2 p-2 text-sm ${
        live
          ? 'border-ink bg-amber-bright'
          : decided
            ? 'border-ink bg-paper'
            : 'border-rule bg-paper'
      } ${dormantReset ? 'opacity-55' : ''}`}
    >
      {dormantReset ? (
        <p className="text-xs font-bold uppercase tracking-wide text-muted">
          Only if the losers side wins
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {match.sides.map((side, index) => (
            <li key={side.entryId ?? `empty-${index}`} className="flex items-center gap-1.5">
              {side.teamColor ? (
                <span
                  aria-hidden
                  className="swatch"
                  style={{ backgroundColor: side.teamColor, width: 10, height: 10 }}
                />
              ) : (
                <span aria-hidden className="w-[10px] shrink-0" />
              )}
              {/*
                Wraps rather than truncates. Names are as long as the roster
                makes them — "Mike D/Mike S" is a realistic worst case — and a
                clipped name is the exact failure the short form exists to
                avoid. Two lines in a taller cell is the cheaper trade, and the
                column is inside a horizontal scroller (§11) so width is free.
              */}
              <span
                className={`min-w-0 flex-1 leading-tight break-words ${
                  side.isWinner === true ? 'font-black' : side.isWinner === false ? 'text-muted' : ''
                }`}
                title={side.label ?? undefined}
              >
                {side.shortLabel ?? side.label ?? '—'}
              </span>
              {side.score !== null && (
                <span className="shrink-0 font-bold tabular-nums">{side.score}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {live && (
        <p className="mt-1 text-[0.65rem] font-black uppercase tracking-widest">On now</p>
      )}
    </div>
  );
}
