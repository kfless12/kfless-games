'use client';

import { useActionState } from 'react';

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

        {picksMade > 0 && (
          <form action={undoAction}>
            <Button pending={undoPending}>Undo last pick</Button>
          </form>
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
