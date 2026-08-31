/**
 * Environment access. Read on demand, fail loudly, never at import time —
 * throwing while a module loads would break `next build` on a host that builds
 * without a database.
 *
 * The full variable surface is SPEC.md §10.3. Only DATABASE_URL is consumed in
 * Phase 0; SESSION_SECRET and ADMIN_CREDENTIAL arrive with auth in Phase 1, and
 * the S3_* group with uploads in Phase 2.
 */
type EnvName =
  | 'DATABASE_URL'
  | 'SESSION_SECRET'
  | 'ADMIN_CREDENTIAL'
  | 'S3_ENDPOINT'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY'
  | 'S3_SECRET_KEY';

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
