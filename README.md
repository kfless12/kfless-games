# kfless games

Mobile-first web app to run a 3-day beer Olympics: 17 players, 4 teams, an
online snake draft, and a tournament engine with a live "up next" queue.

`SPEC.md` is the source of truth. `CLAUDE.md` holds the working rules.

**Status: Phase 0 (skeleton) complete.** Build order is SPEC.md §14.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · PostgreSQL 17 · Drizzle · Docker

## Local development

Postgres runs in Docker; Next runs on the host.

```bash
cp .env.example .env      # DATABASE_URL already points at the compose db
npm install
npm run db:up             # start Postgres (host port 5433)
npm run db:migrate        # apply migrations
npm run dev               # http://localhost:3000
```

The compose Postgres publishes **host port 5433**, not 5432, to avoid clashing
with a Postgres already installed on the machine. Inside the compose network the
port is the normal 5432.

## Full containerised run

Closest thing to production. Builds the app image, runs migrations to
completion, then starts the app.

```bash
docker compose up --build
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` | Production build (standalone output) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:up` / `db:down` | Start / stop the compose Postgres |
| `npm run db:generate` | Generate a migration from `lib/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Drizzle Studio |

## Layout

```
app/                 routes (App Router)
  api/health/        liveness + DB readiness endpoint
lib/
  env.ts             environment access, SPEC.md §10.3
  db/
    index.ts         lazy pg Pool + Drizzle client
    schema.ts        Drizzle schema
    health.ts        Phase 0 connectivity check
drizzle/             generated migrations (committed)
scripts/migrate.ts   migration runner
```

## Docker image targets

`Dockerfile` has two published targets:

- `runner` — the app image. Next standalone output, no dev dependencies.
- `migrator` — applies `drizzle/` migrations and exits. Not the app.

```bash
docker build --target runner -t kfless-games .
```

## Constraints that must not be broken

Full list in SPEC.md §10.2 and CLAUDE.md. The short version:

- `output: 'standalone'` stays set in `next.config.js`.
- No local filesystem writes. Uploads go to S3-compatible object storage.
- No in-memory state across requests. All state lives in Postgres.
- No background workers, cron, or WebSockets. Liveness comes from client polling.
- Points are derived from results at read time, never stored and incremented.
