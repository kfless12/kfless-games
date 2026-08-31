import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// .env.local wins over .env, matching Next.js precedence.
loadEnv({ path: ['.env.local', '.env'], quiet: true });

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
