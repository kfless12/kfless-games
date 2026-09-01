'use client';

import { useActionState } from 'react';

import { saveTeam } from './actions';
import { ImagePicker } from './image-picker';
import { emptySaveState, type SaveState } from './state';

/** SPEC.md §9.2. Captains may rename their team and set a logo at any time. */
export function TeamForm({
  teamId,
  name,
  motto,
  logoUrl,
  colorHex,
}: {
  teamId: string;
  name: string;
  motto: string | null;
  logoUrl: string | null;
  colorHex: string;
}) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    saveTeam,
    emptySaveState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="teamId" value={teamId} />

      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="swatch size-5"
          style={{ backgroundColor: colorHex }}
        />
        <h2 className="section-title">Your team</h2>
      </div>

      <ImagePicker
        name="logo"
        label={logoUrl ? 'Change logo' : 'Add logo'}
        currentUrl={logoUrl}
        shape="square"
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-base font-semibold">
          Team name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={60}
          defaultValue={name}
          className="field"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="motto" className="text-base font-semibold">
          Motto
        </label>
        <input
          id="motto"
          name="motto"
          type="text"
          maxLength={200}
          defaultValue={motto ?? ''}
          className="field"
        />
      </div>

      {state.error && (
        <p role="alert" className="card-shout text-base font-bold">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="card-hot text-base font-bold">
          {state.notice}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary h-14 text-lg"
      >
        {pending ? 'Saving…' : 'Save team'}
      </button>
    </form>
  );
}
