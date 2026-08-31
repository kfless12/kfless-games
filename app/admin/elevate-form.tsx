'use client';

import { useActionState } from 'react';

import { elevate } from './actions';
import { type AdminActionState, emptyAdminState } from './state';

export function ElevateForm() {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    elevate,
    emptyAdminState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor="credential" className="text-lg font-bold">
        Admin credential
      </label>
      <input
        id="credential"
        name="credential"
        type="password"
        autoComplete="off"
        required
        className="h-14 rounded-lg border-2 border-ink px-4 font-mono text-lg"
      />
      {state.error && (
        <p role="alert" className="text-base font-semibold">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-14 rounded-lg bg-ink text-lg font-bold text-paper disabled:opacity-50"
      >
        {pending ? 'Checking…' : 'Elevate'}
      </button>
    </form>
  );
}
