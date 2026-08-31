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
          className="inline-block size-5 rounded-full border border-rule"
          style={{ backgroundColor: colorHex }}
        />
        <h2 className="text-xl font-bold">Your team</h2>
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
          className="h-12 rounded-lg border-2 border-rule px-3 text-base"
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
          className="h-12 rounded-lg border-2 border-rule px-3 text-base"
        />
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg border-2 border-ink p-3 text-base font-semibold">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="rounded-lg border-2 border-rule p-3 text-base font-semibold">
          {state.notice}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-14 rounded-lg bg-ink text-lg font-bold text-paper disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save team'}
      </button>
    </form>
  );
}
