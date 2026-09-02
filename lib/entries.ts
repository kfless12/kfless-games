/**
 * Short names for entries, for match previews.
 *
 * SPEC.md §7.4. A preview reading "Team One — A vs Team Two — B" tells you
 * almost nothing at a glance and does not fit a phone; what people want to know
 * is who is actually playing. So a preview shows the team tag plus the initials
 * of the assigned players, and falls back gracefully when nobody is assigned —
 * SPEC.md §4.4 makes assignment optional and it will often be skipped.
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

/**
 * "Kevin Flessa" -> "KF". A single name gives its first two letters, so a
 * one-word name still produces a two-character tag rather than a lone letter
 * that could belong to anyone.
 */
export function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
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
 * - Players assigned: "T1 KF/JD".
 * - Nobody assigned: "T1-A".
 * - Anything unknown: the stored label, or a dash.
 */
export function shortEntryLabel(entry: EntryIdentity, wholeTeam: boolean): string {
  if (wholeTeam) return entry.teamName ?? entry.label ?? '—';

  const tag = teamTag(entry.teamDraftPosition);

  if (entry.playerNames.length > 0) {
    const initials = entry.playerNames.map(initialsOf).join('/');
    return tag ? `${tag} ${initials}` : initials;
  }

  const letter = entryLetter(entry.label);
  if (tag && letter) return `${tag}-${letter}`;
  if (tag) return tag;
  return entry.label ?? '—';
}
