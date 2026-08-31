import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const MIGRATIONS_FOLDER = './drizzle';
const CONNECT_ATTEMPTS = 15;
const CONNECT_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase(pool: Pool) {
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch (error) {
      if (attempt === CONNECT_ATTEMPTS) throw error;
      console.log(`db not ready (attempt ${attempt}/${CONNECT_ATTEMPTS}), retrying...`);
      await sleep(CONNECT_DELAY_MS);
    }
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await waitForDatabase(pool);
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('migration failed');
  console.error(error);
  process.exit(1);
});
