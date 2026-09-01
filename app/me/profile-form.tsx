'use client';

import { useActionState } from 'react';

import { RATING_FIELDS, RATING_MAX, RATING_MIN, TEXT_FIELDS } from '@/lib/profile';

import { saveProfile } from './actions';
import { ImagePicker } from './image-picker';
import { emptySaveState, type SaveState } from './state';

export type ProfileFormValues = Record<string, string | number | null>;

export function ProfileForm({
  playerId,
  subtitle,
  photoUrl,
  values,
  heading,
}: {
  playerId: string;
  subtitle: string;
  photoUrl: string | null;
  values: ProfileFormValues;
  heading: string;
}) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    saveProfile,
    emptySaveState,
  );

  const str = (key: string) => (values[key] == null ? '' : String(values[key]));

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="playerId" value={playerId} />

      <div>
        <h2 className="section-title">{heading}</h2>
        <p className="mt-1 text-base text-muted">{subtitle}</p>
      </div>

      <ImagePicker name="photo" label={photoUrl ? 'Change photo' : 'Add photo'} currentUrl={photoUrl} />

      <fieldset className="flex flex-col gap-4">
        <legend className="section-title">The basics</legend>
        {TEXT_FIELDS.map(({ key, label, placeholder }) => (
          <Field key={key} name={key} label={label}>
            <input
              id={key}
              name={key}
              type="text"
              defaultValue={str(key)}
              placeholder={placeholder || undefined}
              maxLength={200}
              className={INPUT}
            />
          </Field>
        ))}
        <Field name="weight" label="Weight (lbs)">
          <input
            id="weight"
            name="weight"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            defaultValue={str('weight')}
            className={INPUT}
          />
        </Field>
        <Field name="personalRecordBeers" label="Personal record (beers)">
          <input
            id="personalRecordBeers"
            name="personalRecordBeers"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            defaultValue={str('personalRecordBeers')}
            className={INPUT}
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="section-title">Scouting ratings</legend>
        <p className="text-base text-muted">
          {RATING_MIN}&ndash;{RATING_MAX}, entirely made up by you. These are decorative and
          never affect scoring or seeding.
        </p>
        {RATING_FIELDS.map(({ key, label }) => (
          <Field key={key} name={key} label={label}>
            <input
              id={key}
              name={key}
              type="number"
              inputMode="numeric"
              min={RATING_MIN}
              max={RATING_MAX}
              defaultValue={str(key)}
              className={INPUT}
            />
          </Field>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="section-title">Scouting report</legend>
        <p className="text-base text-muted">Write about yourself in the third person.</p>
        <textarea
          id="scoutingReport"
          name="scoutingReport"
          rows={5}
          maxLength={2000}
          defaultValue={str('scoutingReport')}
          className="field h-auto py-2"
        />
      </fieldset>

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
        {pending ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}

const INPUT = 'field';

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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-base font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}
