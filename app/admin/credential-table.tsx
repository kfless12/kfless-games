'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { manageCredential } from './actions';
import { type AdminActionState, emptyAdminState } from './state';

export type CredentialRow = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  teamName: string | null;
  teamColor: string | null;
  profileComplete: boolean;
  joinUrl: string | null;
  joinCode: string | null;
};

export function CredentialTable({ rows }: { rows: CredentialRow[] }) {
  const [state, manageAction] = useActionState<AdminActionState, FormData>(
    manageCredential,
    emptyAdminState,
  );

  const message = state.error ?? state.notice;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <CopyButton
          label="Copy all links"
          value={rows
            .filter((row) => row.joinUrl)
            .map((row) => `${row.fullName}\t${row.joinUrl}`)
            .join('\n')}
        />
        <MailtoAllButton rows={rows} />
      </div>

      {message && (
        <p role="status" className="card-hot text-base font-bold">
          {message}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id} className="card-quiet">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-lg font-bold">{row.fullName}</span>
              <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
                {row.teamName && (
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="swatch"
                      style={{ backgroundColor: row.teamColor ?? undefined }}
                    />
                    {row.teamName}
                  </span>
                )}
                <span>{row.role}</span>
              </span>
            </div>

            <p className="mt-1 break-all text-base text-muted">{row.email}</p>

            <p className="mt-2 flex flex-wrap items-center gap-3 text-base">
              <span className={row.profileComplete ? 'font-semibold' : 'text-muted'}>
                {row.profileComplete ? 'Card complete' : 'Card unfinished'}
              </span>
              <Link href={`/admin/players/${row.id}`} className="font-bold underline">
                Edit card
              </Link>
            </p>

            {row.joinUrl && row.joinCode ? (
              <>
                <p className="mt-3 break-all font-mono text-sm text-muted">{row.joinUrl}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-md border-2 border-ink bg-ink px-3 py-1.5 font-mono text-xl tracking-widest tabular-nums text-paper">
                    {row.joinCode}
                  </span>
                  <CopyButton label="Copy link" value={row.joinUrl} />
                  <form action={manageAction}>
                    <input type="hidden" name="playerId" value={row.id} />
                    <input type="hidden" name="operation" value="issue" />
                    <SubmitButton>Re-issue</SubmitButton>
                  </form>
                  <form action={manageAction}>
                    <input type="hidden" name="playerId" value={row.id} />
                    <input type="hidden" name="operation" value="revoke" />
                    <SubmitButton>Revoke</SubmitButton>
                  </form>
                </div>
              </>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold">No credential</span>
                <form action={manageAction}>
                  <input type="hidden" name="playerId" value={row.id} />
                  <input type="hidden" name="operation" value="issue" />
                  <SubmitButton>Issue</SubmitButton>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 44px minimum tap target, per SPEC.md §11. */
const BUTTON = 'btn';

function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="submit" className={BUTTON}>
      {children}
    </button>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard needs a secure context. Fall back to selecting the text.
      window.prompt('Copy this:', value);
    }
  }

  return (
    <button type="button" onClick={copy} className={BUTTON}>
      {copied ? 'Copied' : label}
    </button>
  );
}

/**
 * "Copy all as mailto" from SPEC.md §3.2. One mailto per person, because a
 * single mail cannot carry seventeen different links.
 */
function MailtoAllButton({ rows }: { rows: CredentialRow[] }) {
  const value = rows
    .filter((row) => row.joinUrl)
    .map((row) => {
      const subject = encodeURIComponent('Your kfless games link');
      const body = encodeURIComponent(
        `${row.fullName} —\n\nYour link, tap once and you're in for good:\n${row.joinUrl}\n\n` +
          `If you can't find this on the day, your backup code is ${row.joinCode}.\n`,
      );
      return `mailto:${row.email}?subject=${subject}&body=${body}`;
    })
    .join('\n');

  return <CopyButton label="Copy all as mailto" value={value} />;
}
