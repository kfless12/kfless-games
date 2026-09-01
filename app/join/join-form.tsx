'use client';

import { useActionState } from 'react';

import { type JoinState, submitJoinCode } from './actions';

const initialState: JoinState = { error: null };

export function JoinForm() {
  const [state, formAction, pending] = useActionState(submitJoinCode, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label htmlFor="code" className="section-title text-center">
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
        className="field h-20 border-[3px] border-ink text-center font-mono text-4xl tracking-[0.35em] tabular-nums"
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
        {pending ? 'Checking…' : "Let me in"}
      </button>
    </form>
  );
}
