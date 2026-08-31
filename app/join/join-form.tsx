'use client';

import { useActionState } from 'react';

import { type JoinState, submitJoinCode } from './actions';

const initialState: JoinState = { error: null };

export function JoinForm() {
  const [state, formAction, pending] = useActionState(submitJoinCode, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label htmlFor="code" className="text-lg font-bold">
        Your 6-digit code
      </label>

      {/* Numeric keypad on phones, and no autofill guessing at it. */}
      <input
        id="code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        required
        placeholder="000000"
        className="h-16 rounded-lg border-2 border-ink px-4 text-center font-mono text-3xl tracking-[0.4em] tabular-nums"
      />

      {state.error && (
        <p role="alert" className="text-base font-semibold text-ink">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-14 rounded-lg bg-ink text-lg font-bold text-paper disabled:opacity-50"
      >
        {pending ? 'Checking…' : "Let me in"}
      </button>
    </form>
  );
}
