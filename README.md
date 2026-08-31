# kfless games

Mobile-first web app to run a 3-day beer Olympics: 17 players, 4 teams, an
online snake draft, and a tournament engine with a live "up next" queue.

`SPEC.md` is the source of truth. `CLAUDE.md` holds the working rules.

**Status: Phase 3 (the draft) complete.** Build order is SPEC.md §14.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · PostgreSQL 17 · Drizzle · Docker

## Local development

Postgres runs in Docker; Next runs on the host.

```bash
cp .env.example .env
# fill in SESSION_SECRET and ADMIN_CREDENTIAL — both are required now:
#   openssl rand -hex 32
npm install
npm run db:up             # start Postgres (host port 5433)
npm run db:migrate        # apply migrations
npm run db:seed           # 17 players, 4 teams, 17 credentials
npm run dev               # http://localhost:3000
```

For a database you can actually look at — 17 avatars, bios and rating lines, plus
team logos — use `npm run db:demo` instead of `db:seed`. It is deterministic, so
a reseed produces identical data. Placeholder profiles are deliberately **off**
in the normal seed: at the real event an invented stat line nobody wrote is
worse than an obviously empty card.

Then open `/admin` as the seeded admin to get everyone's join link. To find the
admin's own link before you have a session:

```bash
docker compose exec -T db psql -U kfless -d kfless_games -tAc "select '/join/'||c.token from credentials c join players p on p.id=c.player_id where p.is_admin and c.revoked_at is null"
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
| `npm test` | All tests (needs the compose Postgres up) |
| `npm run test:unit` | Pure-logic tests only, no database |
| `npm run test:watch` | Tests in watch mode |
| `npm run db:up` / `db:down` | Start / stop the compose Postgres |
| `npm run db:generate` | Generate a migration from `lib/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed the roster from `scripts/seed-data.ts` |
| `npm run db:reset` | Wipe and reseed (`SEED_RESET=1`) |
| `npm run db:demo` | Wipe, reseed, **and** fill placeholder avatars/bios/ratings |
| `npm run db:studio` | Drizzle Studio |

## Layout

```
app/                 routes (App Router)
  page.tsx           landing page
  draft/             draft board, picks, admin controls, 5s polling
  me/                self-service profile + captain team editing
  join/              magic link redemption + 6-digit code entry
  admin/             gated admin console, credential list, edit any card
  api/health/        liveness + DB readiness endpoint
  api/images/[id]/   serves images out of Postgres
lib/
  auth.ts            THE auth module — identify() and nothing else
  session.ts         cookie format + role resolution (pure, tested)
  rate-limit.ts      backoff arithmetic (pure, tested)
  credentials.ts     token / join-code formats, shared with the seed
  images.ts          upload validation: magic bytes, dimensions, caps (tested)
  upload.ts          storing an image and cleaning up a replaced one
  profile.ts         profile field list + form parsing (tested)
  png.ts             tiny PNG encoder for the demo seed (tested)
  uuid.ts            id validation, so a bad id is a 404 not a 500
  draft.ts           snake order + pick authorization (pure, tested)
  draft-state.ts     everything the draft board reads, in one query
  audit.ts           append-only audit trail
  env.ts             environment access, SPEC.md §10.3
  db/
    index.ts         lazy pg Pool + Drizzle client
    schema.ts        Drizzle schema, SPEC.md §4
    health.ts        connectivity check
drizzle/             generated migrations (committed)
scripts/
  migrate.ts         migration runner
  seed.ts            roster seeder, validates before writing
  seed-validate.ts   roster validation (pure, tested)
  fake-profiles.ts   deterministic placeholder avatars/bios (tested)
  seed-data.ts       THE ROSTER — replace the placeholder names here
```

## Tests

Node's built-in test runner via `tsx`. No test framework dependency.

```bash
npm run db:up && npm run db:migrate   # database tests need Postgres
npm test
```

What gets a test and what does not is in CLAUDE.md. Short version: complex
logic, anything touching undo, security-relevant code, and database invariants
that TypeScript cannot see. Not layout, not copy, not framework behaviour, and
no browser driver.

`lib/db/schema.test.ts` runs against the compose Postgres inside transactions
that always roll back. Do not point it at a database with real event data.

## Auth

Per-person magic links with a 6-digit day-of fallback (SPEC.md §3.2).

- `/join/<token>` sets a signed, httpOnly cookie for 90 days and redirects.
- `/join` takes the 6-digit code for anyone who can't find their email.
- Roles: `ADMIN` (from `players.is_admin`), `CAPTAIN` (`players.is_captain`),
  `PLAYER`. No cookie means `PUBLIC` — read-only, no admin console.
- `ADMIN_CREDENTIAL` is break-glass only: it elevates an **already identified**
  person, so admin actions always have a real actor in `audit_log`.
- Credential submission is rate limited per IP in Postgres, not in memory.

## The draft

Snake order per SPEC.md §1.1: 13 picks over 4 teams, and position 4 takes pick
13 and ends with 5 players. That is intentional and self-balancing — do not
"fix" it. Pick 13 is permanently Mister Irrelevant, enforced by a generated
column so it cannot be edited away and clears itself if the pick is undone.

There is no clock, no auto-pick, and no draft-order randomizer (SPEC.md §12).

Every mutation takes a row lock on `event_state` first, so two captains tapping
DRAFT at the same instant cannot both claim the same pick number. Claiming a
player is a conditional UPDATE, so the database decides whether they were still
available, not a prior read.

`lib/draft.ts` holds the order maths and the pick authorization as pure
functions, so both are unit tested rather than only reachable through a request.
`app/draft/actions.ts` re-checks every rule server-side — SPEC.md §5.2 is
explicit that the UI is not the control.

## Images

Player photos and team logos live in Postgres as `bytea` and are served from
`/api/images/<id>` with immutable caching. No object storage, no filesystem
writes — SPEC.md §9.3 has the measurements behind that choice.

The browser resizes to 800px on a canvas before uploading, so a phone sends
~150KB instead of ~7MB and EXIF (including GPS) never reaches the database. PNG
sources stay PNG so a logo keeps its transparency; everything else becomes JPEG.

The server validates rather than re-encodes: magic bytes must match the format,
dimensions come from the image header, and the 5MB / 2000px caps are enforced
there. `experimental.serverActions.bodySizeLimit` is raised to 6mb in
`next.config.js` because the 1MB default would reject a legitimate upload as a
413 before any of that runs.

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
- No local filesystem writes. Images are stored in Postgres as `bytea` and
  served from `/api/images/<id>`.
- No in-memory state across requests. All state lives in Postgres.
- No background workers, cron, or WebSockets. Liveness comes from client polling.
- Points are derived from results at read time, never stored and incremented.
- All auth goes through `identify()` in `lib/auth.ts`. No route handler or
  component reads a token, code, or cookie directly.
- Authorization is checked on the server in every action. A hidden or disabled
  button is not a control.
