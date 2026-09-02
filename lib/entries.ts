/**
 * Short names for entries, for match previews.
 *
 * SPEC.md §7.4. A preview reading "Team One — A vs Team Two — B" tells you
 * almost nothing at a glance and does not fit a phone; what people want to know
 * is who is actually playing. So a preview shows the team tag plus the first
 * names of the assigned players, and falls back gracefully when nobody is
 * assigned — SPEC.md §4.4 makes assignment optional and it will often be
 * skipped.
 *
 * The team tag comes from `teams.draft_position`, never from the entry label.
 * Labels are snapshots taken when the tournament was generated (see
 * lib/engine/persist.ts), and captains can rename a team afterwards, so the
 * name inside a stored label goes stale. Draft position cannot.
 */

export type EntryIdentity = {
  /** The stored label, e.g. "Team One — A". Used only as a last-resort fallback. */
  label: string | null;
  teamName: string | null;
  teamDraftPosition: number | null;
  /** Full names of the assigned players, in entry order. Empty when unassigned. */
  playerNames: string[];
};

/**
 * The trailing entry letter of a generated label: "Team One — A" -> "A".
 *
 * Parsed off the end rather than the start, because the team name is on the
 * front and may itself contain an em dash once a captain renames the team.
 */
export function entryLetter(label: string | null): string | null {
  if (!label) return null;
  const match = /—\s*([A-Z])\s*$/.exec(label);
  return match ? match[1] : null;
}

/** "Kevin Flessa" -> "Kevin". What people are actually called. */
export function firstNameOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  return words[0] ?? '?';
}

/** "Kevin Flessa" -> "F". Empty when there is no surname to take. */
function lastInitialOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? words[words.length - 1][0].toUpperCase() : '';
}

/**
 * First names for a set of players, disambiguated only where they collide.
 *
 * Two Mikes in one entry would otherwise render "Mike/Mike", which is worse
 * than useless — it names nobody. When first names clash a last initial is
 * added, and only to the names that clash, so the common case stays short.
 */
export function displayNames(fullNames: string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of fullNames) {
    const first = firstNameOf(name);
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }

  return fullNames.map((name) => {
    const first = firstNameOf(name);
    if ((counts.get(first) ?? 0) < 2) return first;
    const initial = lastInitialOf(name);
    return initial ? `${first} ${initial}` : first;
  });
}

/** "T1", or null when the draft position is unknown. */
export function teamTag(draftPosition: number | null): string | null {
  return draftPosition === null ? null : `T${draftPosition}`;
}

/**
 * The short form.
 *
 * - Whole-team game (one entry per team): the team name. There is no ambiguity
 *   to resolve, and the name is what people call it.
 * - Players assigned: "T1 Kevin/Jake", or "T1 Mike D/Mike S" if they collide.
 * - Nobody assigned: "T1-A".
 * - Anything unknown: the stored label, or a dash.
 */
export function shortEntryLabel(entry: EntryIdentity, wholeTeam: boolean): string {
  if (wholeTeam) return entry.teamName ?? entry.label ?? '—';

  const tag = teamTag(entry.teamDraftPosition);

  if (entry.playerNames.length > 0) {
    const names = displayNames(entry.playerNames).join('/');
    return tag ? `${tag} ${names}` : names;
  }

  const letter = entryLetter(entry.label);
  if (tag && letter) return `${tag}-${letter}`;
  if (tag) return tag;
  return entry.label ?? '—';
}
