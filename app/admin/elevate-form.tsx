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
        className="field h-14 font-mono text-lg"
      />
      {state.error && (
        <p role="alert" className="card-shout text-base font-bold">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary h-14 text-lg"
      >
        {pending ? 'Checking…' : 'Elevate'}
      </button>
    </form>
  );
}
