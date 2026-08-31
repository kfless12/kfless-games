'use server';

import { redirect } from 'next/navigation';

import { clearSession, clientIp, redeemJoinCode } from '@/lib/auth';

export type JoinState = { error: string | null };

/**
 * Day-of fallback: the 6-digit code the admin reads aloud in the yard
 * (SPEC.md §3.2). The code arrives in a POST body, never a query string
 * (SPEC.md §3.4).
 */
export async function submitJoinCode(
  _previous: JoinState,
  formData: FormData,
): Promise<JoinState> {
  const raw = String(formData.get('code') ?? '');
  const code = raw.replace(/\D/g, '');

  if (code.length !== 6) {
    return { error: 'Enter the 6 digits from your code.' };
  }

  const result = await redeemJoinCode(code, await clientIp());

  if (result.ok) redirect('/');

  if (result.reason === 'RATE_LIMITED') {
    const seconds = result.retryAfterSeconds ?? 60;
    return { error: `Too many tries. Wait ${seconds} second${seconds === 1 ? '' : 's'}.` };
  }

  return { error: "That code isn't right. Check with whoever is running this." };
}

export async function signOut() {
  await clearSession();
  redirect('/join');
}
