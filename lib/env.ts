/**
 * Environment access. Read on demand, fail loudly, never at import time —
 * throwing while a module loads would break `next build` on a host that builds
 * without a database.
 *
 * The full variable surface is SPEC.md §10.3 — these three and nothing else.
 * There is deliberately no object storage configuration: images live in
 * Postgres (SPEC.md §9.3).
 */
type EnvName = 'DATABASE_URL' | 'SESSION_SECRET' | 'ADMIN_CREDENTIAL';

export function requireEnv(name: EnvName): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'Copy .env.example to .env and fill it in; run `npm run db:up` for local Postgres.',
    );
  }
  return value;
}

export function databaseUrl(): string {
  return requireEnv('DATABASE_URL');
}
