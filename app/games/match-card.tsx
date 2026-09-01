'use client';

import { useActionState, useState } from 'react';

import { undoResult } from './actions';
import { emptyResultState, type ResultState } from './state';
import { usePendingSubmit } from './use-pending-submit';

export type MatchSide = {
  entryId: string | null;
  label: string | null;
  teamName: string | null;
  teamColor: string | null;
  score: number | null;
  isWinner: boolean | null;
};

export type MatchCardData = {
  id: string;
  bracket: string;
  round: number;
  slot: number;
  status: string;
  station: string | null;
  sides: MatchSide[];
};

/**
 * One match, with result entry when the viewer is allowed to report it.
 *
 * `canReport` only decides what renders. lib/engine/submit.ts re-checks on the
 * server — SPEC.md §8 names who may submit, and a hidden button is not a
 * control.
 */
export function MatchCard({
  match,
  canReport,
  label,
}: {
  match: MatchCardData;
  canReport: boolean;
  label: string;
}) {
  /*
   * Result entry goes through the pending queue rather than straight at the
   * server, so a dropped request is retried and the badge stays up until it
   * lands. SPEC.md §8.
   */
  const { pending, rejected, saving, submit, retryNow, nextRetryInMs } = usePendingSubmit(
    match.id,
  );
  const [undoState, undoAction, undoPending] = useActionState<ResultState, FormData>(
    undoResult,
    emptyResultState,
  );
  const [editing, setEditing] = useState(false);

  const complete = match.status === 'COMPLETE';
  const playable = match.sides.every((side) => side.entryId !== null);

  /*
   * The grand-final reset is played only if the losers-bracket side wins the
   * grand final, so while it has no participants it is conditional rather than
   * pending. Labelling it "Waiting" makes a finished game look unfinished — and
   * mid-tournament it implies a match that is coming when it may never be.
   * Same treatment as the bracket view.
   */
  const conditional =
    match.bracket === 'GRAND_FINAL' &&
    match.round === 2 &&
    !complete &&
    match.sides.every((side) => side.entryId === null);
  const message = rejected ?? undoState.error ?? undoState.notice;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const winnerEntryId = String(formData.get('winnerEntryId') ?? '');
    if (!winnerEntryId) return;

    const scores: Record<string, number> = {};
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('score-')) continue;
      const raw = String(value).trim();
      if (!/^\d+$/.test(raw)) continue;
      scores[key.slice('score-'.length)] = Number(raw);
    }

    submit({ matchId: match.id, winnerEntryId, scores });
    setEditing(false);
  }

  return (
    <li className={`card-quiet flex flex-col gap-3 ${complete ? '' : playable ? 'border-ink' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-black uppercase tracking-widest text-muted">{label}</span>
        <span className={`chip ${complete ? 'chip-quiet' : playable ? 'chip-amber' : 'chip-quiet'}`}>
          {complete ? 'Final' : playable ? 'Ready' : conditional ? 'If needed' : 'Waiting'}
        </span>
      </div>

      {conditional && (
        <p className="text-base font-bold text-muted">
          Only played if the losers side wins the grand final.
        </p>
      )}

      {!conditional && (
      <ul className="flex flex-col gap-1">
        {match.sides.map((side, index) => (
          <li
            key={side.entryId ?? `empty-${index}`}
            className="flex items-center justify-between gap-3 text-base"
          >
            <span className="flex min-w-0 items-center gap-2">
              {side.teamColor && (
                <span aria-hidden className="swatch" style={{ backgroundColor: side.teamColor }} />
              )}
              <span className={side.isWinner ? 'font-black' : side.isWinner === false ? 'text-muted' : ''}>
                {side.label ?? <span className="text-muted">Waiting…</span>}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 tabular-nums">
              {side.score !== null && <span className="font-bold">{side.score}</span>}
              {side.isWinner && <span aria-label="winner">✓</span>}
            </span>
          </li>
        ))}
      </ul>
      )}

      {/*
        SPEC.md §8: a persistent badge until the result actually lands. It says
        how many tries it has had, so a long silence reads as a connection
        problem rather than as the app having eaten the score.
      */}
      {pending && (
        <div role="status" className="card-shout flex flex-col gap-2 p-3">
          <p className="text-base font-bold">
            Not saved yet — will keep trying
            {pending.attempts > 0 && ` (${pending.attempts} ${pending.attempts === 1 ? 'try' : 'tries'})`}
          </p>
          <p className="text-sm">
            {pending.lastError ?? 'Sending…'}
            {pending.attempts > 0 && nextRetryInMs > 0 &&
              ` · retrying every ${Math.round(nextRetryInMs / 1000)}s`}
          </p>
          <button type="button" onClick={retryNow} className="btn btn-primary min-h-[2.5rem]">
            Try now
          </button>
        </div>
      )}

      {message && (
        <p role="status" className="card-hot text-base font-bold">
          {message}
        </p>
      )}

      {canReport && playable && (complete ? editing : true) && (
        <form onSubmit={onSubmit} className="flex flex-col gap-3 border-t-2 border-rule pt-3">
          <input type="hidden" name="matchId" value={match.id} />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-base font-semibold">Who won?</legend>
            {match.sides.map((side) =>
              side.entryId ? (
                <label key={side.entryId} className="flex items-center gap-3 text-base">
                  <input
                    type="radio"
                    name="winnerEntryId"
                    value={side.entryId}
                    defaultChecked={side.isWinner === true}
                    required
                    className="size-6"
                  />
                  <span className="flex-1">{side.label}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={999}
                    name={`score-${side.entryId}`}
                    defaultValue={side.score ?? ''}
                    placeholder="cups"
                    aria-label={`Score for ${side.label}`}
                    className="field w-20 shrink-0 px-2"
                  />
                </label>
              ) : null,
            )}
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">
              {saving ? 'Saving…' : complete ? 'Save change' : 'Save result'}
            </button>
            {complete && (
              <button type="button" onClick={() => setEditing(false)} className="btn btn-quiet">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {canReport && complete && !editing && (
        <div className="flex flex-wrap gap-2 border-t-2 border-rule pt-3">
          <button type="button" onClick={() => setEditing(true)} className="btn">
            Change result
          </button>
          <form action={undoAction}>
            <input type="hidden" name="matchId" value={match.id} />
            <button type="submit" disabled={undoPending} className="btn">
              {undoPending ? 'Undoing…' : 'Undo'}
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
