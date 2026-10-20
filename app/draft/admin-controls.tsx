'use client';

import { useActionState, useState } from 'react';

import { setDraftPaused, setDraftStatus, undoLastPick } from './actions';
import { type DraftActionState, emptyDraftState } from './state';

/** SPEC.md §5.4. Pick on behalf of any captain (via the pool), undo, pause/resume. */
export function AdminControls({
  status,
  paused,
  picksMade,
  totalPicks,
}: {
  status: 'NOT_STARTED' | 'LIVE' | 'COMPLETE';
  paused: boolean;
  picksMade: number;
  totalPicks: number;
}) {
  const [statusState, statusAction, statusPending] = useActionState<DraftActionState, FormData>(
    setDraftStatus,
    emptyDraftState,
  );
  const [pauseState, pauseAction, pausePending] = useActionState<DraftActionState, FormData>(
    setDraftPaused,
    emptyDraftState,
  );
  const [undoState, undoAction, undoPending] = useActionState<DraftActionState, FormData>(
    undoLastPick,
    emptyDraftState,
  );

  /*
   * SPEC.md §5.4 gives the admin "undo last pick". On a complete draft that
   * one tap reopens the whole thing — rosters, Mister Irrelevant — and the
   * button sits here for all three days next to the thing the admin actually
   * wants. So, once the draft is complete, it takes two taps and the second
   * one says what it will do. The action re-checks the confirmation.
   */
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const undoNeedsConfirm = status === 'COMPLETE';

  const message =
    statusState.error ??
    pauseState.error ??
    undoState.error ??
    statusState.notice ??
    pauseState.notice ??
    undoState.notice;

  return (
    <section className="card">
      <h2 className="section-title">Admin</h2>
      <p className="mt-1 text-base text-muted">
        {picksMade} of {totalPicks} picks in.
      </p>

      {message && (
        <p role="status" className="card-hot mt-3 text-base font-bold">
          {message}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {status === 'NOT_STARTED' && (
          <form action={statusAction}>
            <input type="hidden" name="status" value="LIVE" />
            <Button pending={statusPending}>Start the draft</Button>
          </form>
        )}

        {status === 'LIVE' && (
          <form action={pauseAction}>
            <input type="hidden" name="paused" value={paused ? 'false' : 'true'} />
            <Button pending={pausePending}>{paused ? 'Resume' : 'Pause'}</Button>
          </form>
        )}

        {status === 'COMPLETE' && (
          <form action={statusAction}>
            <input type="hidden" name="status" value="LIVE" />
            <Button pending={statusPending}>Reopen the draft</Button>
          </form>
        )}

        {picksMade > 0 && !undoNeedsConfirm && (
          <form action={undoAction}>
            <Button pending={undoPending}>Undo last pick</Button>
          </form>
        )}

        {picksMade > 0 && undoNeedsConfirm && !confirmingUndo && (
          <button type="button" onClick={() => setConfirmingUndo(true)} className="btn">
            Undo last pick
          </button>
        )}

        {picksMade > 0 && undoNeedsConfirm && confirmingUndo && (
          <div
            role="alertdialog"
            aria-label="Confirm undo"
            className="card-shout flex w-full flex-col gap-2 p-3"
          >
            <p className="text-base font-bold">
              Undo pick {picksMade}? The draft is complete, so this reopens it: rosters stop
              being final and Mister Irrelevant loses the label until pick {totalPicks} is made
              again.
            </p>
            <div className="flex flex-wrap gap-2">
              <form action={undoAction} className="flex-1">
                <input type="hidden" name="confirmReopen" value="true" />
                <button type="submit" disabled={undoPending} className="btn btn-shout w-full">
                  {undoPending ? 'Undoing…' : 'Yes, undo and reopen'}
                </button>
              </form>
              <button
                type="button"
                onClick={() => setConfirmingUndo(false)}
                className="btn btn-quiet"
              >
                Keep it
              </button>
            </div>
          </div>
        )}

        {status === 'LIVE' && picksMade === 0 && (
          <form action={statusAction}>
            <input type="hidden" name="status" value="NOT_STARTED" />
            <Button pending={statusPending}>Back to not started</Button>
          </form>
        )}
      </div>
    </section>
  );
}

function Button({ children, pending }: { children: React.ReactNode; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn"
    >
      {pending ? 'Working…' : children}
    </button>
  );
}
