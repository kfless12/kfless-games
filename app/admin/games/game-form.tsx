'use client';

import { useActionState, useState } from 'react';

import {
  ENTRY_AGGREGATIONS,
  FORMAT_LABELS,
  GAME_FORMATS,
  type GameFormat,
  scoresByWins,
} from '@/lib/games';

import { createGame, updateGame } from './actions';
import { emptyGameState, type GameActionState } from './state';

export type GameFormValues = {
  id?: string;
  name: string;
  format: GameFormat;
  entriesPerTeam: number;
  entrySize: number | null;
  pointsMatrix: string;
  pointsPerWin: number | null;
  entryAggregation: string;
  scheduledDay: number | null;
  station: string | null;
  sortOrder: number;
  spansMultipleDays: boolean;
  rules: string | null;
};

const BLANK: GameFormValues = {
  name: '',
  format: 'ROUND_ROBIN',
  entriesPerTeam: 1,
  entrySize: null,
  pointsMatrix: '100, 70, 50, 30',
  pointsPerWin: 50,
  entryAggregation: 'SUM',
  scheduledDay: null,
  station: null,
  sortOrder: 0,
  spansMultipleDays: false,
  rules: null,
};

const INPUT = 'h-12 rounded-lg border-2 border-rule px-3 text-base';

export function GameForm({
  values = BLANK,
  mode,
}: {
  values?: GameFormValues;
  mode: 'create' | 'edit';
}) {
  const [state, formAction, pending] = useActionState<GameActionState, FormData>(
    mode === 'create' ? createGame : updateGame,
    emptyGameState,
  );
  const [format, setFormat] = useState<GameFormat>(values.format);
  const [open, setOpen] = useState(mode === 'edit');

  if (mode === 'create' && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-14 rounded-lg bg-ink text-lg font-bold text-paper"
      >
        Add a game
      </button>
    );
  }

  const isBracket = format === 'DOUBLE_ELIM' || format === 'SINGLE_ELIM';

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-lg border-2 border-ink p-4">
      {values.id && <input type="hidden" name="gameId" value={values.id} />}

      <h3 className="text-lg font-bold">{mode === 'create' ? 'New game' : 'Edit'}</h3>

      <Field name={`name-${values.id ?? 'new'}`} label="Name">
        <input
          id={`name-${values.id ?? 'new'}`}
          name="name"
          type="text"
          required
          maxLength={80}
          defaultValue={values.name}
          placeholder="Flip Cup"
          className={INPUT}
        />
      </Field>

      <Field name={`format-${values.id ?? 'new'}`} label="Format">
        <select
          id={`format-${values.id ?? 'new'}`}
          name="format"
          value={format}
          onChange={(event) => setFormat(event.target.value as GameFormat)}
          className={INPUT}
        >
          {GAME_FORMATS.map((option) => (
            <option key={option} value={option}>
              {FORMAT_LABELS[option]}
            </option>
          ))}
        </select>
      </Field>

      <Field name={`entriesPerTeam-${values.id ?? 'new'}`} label="Entries per team">
        <input
          id={`entriesPerTeam-${values.id ?? 'new'}`}
          name="entriesPerTeam"
          type="number"
          inputMode="numeric"
          min={1}
          max={8}
          defaultValue={values.entriesPerTeam}
          className={INPUT}
        />
        <span className="text-sm text-muted">
          Beer pong is 2. Everything else is usually 1.
        </span>
      </Field>

      {/*
        Round robin scores by wins and has no ranked finish, so it asks for a
        per-win value instead of a placement matrix. SPEC.md §6.3.
      */}
      {scoresByWins(format) ? (
        <Field name={`pointsPerWin-${values.id ?? 'new'}`} label="Points per win">
          <input
            id={`pointsPerWin-${values.id ?? 'new'}`}
            name="pointsPerWin"
            type="number"
            inputMode="numeric"
            min={0}
            max={100000}
            required
            defaultValue={values.pointsPerWin ?? 50}
            className={INPUT}
          />
          <span className="text-sm text-muted">
            Every win pays this; a loss pays nothing. Three wins out of three is worth three
            times one win &mdash; there is no 1st, 2nd or 3rd prize in a round robin.
          </span>
        </Field>
      ) : (
        <Field name={`pointsMatrix-${values.id ?? 'new'}`} label="Points by placement">
          <input
            id={`pointsMatrix-${values.id ?? 'new'}`}
            name="pointsMatrix"
            type="text"
            required
            defaultValue={values.pointsMatrix}
            placeholder="100, 70, 50, 30"
            className={INPUT}
          />
          <span className="text-sm text-muted">
            Highest first: 1st place, then 2nd, and so on. A game is worth whatever this says
            &mdash; there is no format weighting.
          </span>
        </Field>
      )}

      <Field name={`entryAggregation-${values.id ?? 'new'}`} label="Multiple entries combine by">
        <select
          id={`entryAggregation-${values.id ?? 'new'}`}
          name="entryAggregation"
          defaultValue={values.entryAggregation}
          className={INPUT}
        >
          {ENTRY_AGGREGATIONS.map((option) => (
            <option key={option} value={option}>
              {option === 'SUM' ? 'Adding both up' : 'Taking the better one'}
            </option>
          ))}
        </select>
      </Field>

      <Field name={`station-${values.id ?? 'new'}`} label="Station">
        <input
          id={`station-${values.id ?? 'new'}`}
          name="station"
          type="text"
          maxLength={80}
          defaultValue={values.station ?? ''}
          placeholder="Pong Table — Patio"
          className={INPUT}
        />
      </Field>

      <div className="flex gap-3">
        <Field name={`scheduledDay-${values.id ?? 'new'}`} label="Day (1–3)">
          <input
            id={`scheduledDay-${values.id ?? 'new'}`}
            name="scheduledDay"
            type="number"
            inputMode="numeric"
            min={1}
            max={3}
            defaultValue={values.scheduledDay ?? ''}
            className={INPUT}
          />
        </Field>
        <Field name={`sortOrder-${values.id ?? 'new'}`} label="Order">
          <input
            id={`sortOrder-${values.id ?? 'new'}`}
            name="sortOrder"
            type="number"
            inputMode="numeric"
            min={0}
            max={999}
            defaultValue={values.sortOrder}
            className={INPUT}
          />
        </Field>
      </div>

      {isBracket && (
        <Field name={`entrySize-${values.id ?? 'new'}`} label="Players per entry (optional)">
          <input
            id={`entrySize-${values.id ?? 'new'}`}
            name="entrySize"
            type="number"
            inputMode="numeric"
            min={1}
            max={17}
            defaultValue={values.entrySize ?? ''}
            className={INPUT}
          />
        </Field>
      )}

      <label className="flex items-center gap-3 text-base font-semibold">
        <input
          type="checkbox"
          name="spansMultipleDays"
          defaultChecked={values.spansMultipleDays}
          className="size-6"
        />
        Runs across more than one day
      </label>

      <Field name={`rules-${values.id ?? 'new'}`} label="Rules (optional)">
        <textarea
          id={`rules-${values.id ?? 'new'}`}
          name="rules"
          rows={3}
          maxLength={4000}
          defaultValue={values.rules ?? ''}
          className="rounded-lg border-2 border-rule p-3 text-base"
        />
      </Field>

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

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="h-12 flex-1 rounded-lg bg-ink text-base font-bold text-paper disabled:opacity-50"
        >
          {pending ? 'Saving…' : mode === 'create' ? 'Add game' : 'Save'}
        </button>
        {mode === 'create' && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-12 rounded-lg border-2 border-rule px-4 text-base font-bold"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  children,
}: {
  name: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <label htmlFor={name} className="text-base font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}
