# kfless games

Mobile-first web app to run a 3-day beer Olympics: 17 players, 4 teams, an
online snake draft, and a tournament engine with a live "up next" queue.

`SPEC.md` is the source of truth. `CLAUDE.md` holds the working rules.

**Status: Phase 7 (polish) complete.** Build order is SPEC.md §14.

A throwaway Cloudflare Workers demo also exists (SPEC.md §16) so the app can be
shared before the real host is picked. It is built to be deleted — see
[Temporary: the Cloudflare demo](#temporary-the-cloudflare-demo).

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
| `npm run db:dry-run` | A completed draft **plus** a played-out 3-day event, for looking at the UI |
| `npm run db:studio` | Drizzle Studio |
| `npm run cf:build` | Build the Cloudflare Worker (temporary, SPEC.md §16) |
| `npm run cf:preview` | Build and run the Worker locally in `workerd` |
| `npm run cf:deploy` | Build and deploy the Worker (needs Node 22+) |

## Layout

```
app/                 routes (App Router)
  globals.css        the design system — tokens and component classes
  ui.tsx             shared chrome: header, section heading, marks, badges
  bottom-nav.tsx     the four-item nav from §11
  page.tsx           the player dashboard (§7.2)
  queue/             all stations, start/bump controls
  poller.tsx         shared 10s poller with a reconnecting state
  api/pulse/         reachability check the poller can fail against
  draft/             draft board, picks, admin controls, 5s polling
  games/             standings, per-game match list, result entry
  games/bracket-view.tsx  the bracket, horizontally scrolled (§11)
  admin/games/       create/edit games, build and clear brackets
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
  games.ts           game config + points matrix parsing (pure, tested)
  scoring.ts         the leaderboard and §6.5 tie-breakers (pure, tested)
  queue.ts           station queues, "you're up", start rules (pure, tested)
  queue-db.ts        loads the queue in one pass
  pending-results.ts the localStorage retry queue (pure, tested)
  engine/
    seeding.ts       bracket order, same-team separation, byes
    bracket.ts       the full skeleton with every pointer wired
    replay.ts        replays results; placements; readiness
    round-robin.ts   circle method, standings, tie-breakers
    ffa.ts           one heat, placement validation
    persist.ts       writes a generated tournament into Postgres
    placement.ts     elimination order -> placements, shared by both paths
    results.ts       reporting, recursive undo, game_results
    submit.ts        who may submit (§8), and marking a game complete
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
  dry-run.ts         plays a whole 3-day event so the UI has real data
public/logo.svg      the event mark, hand-authored SVG
```

## Look and feel

Light, high-contrast, and warm — beer-hall colours on cream paper, heavy black
rules and hard offset shadows. Light is not a default here, it is the
requirement: SPEC.md §11 points out the event is outdoors in daylight, so dark
mode is explicitly rejected as the default and the optional toggle is skipped.

`app/globals.css` holds the whole system as tokens plus a small set of component
classes (`.card`, `.card-hot`, `.card-shout`, `.btn`, `.chip`, `.display`,
`.eyebrow`, `.foam-edge`). Pages compose those; they do not invent colours.

Every text-on-background pair is at or above WCAG AA (4.5:1) at its actual size:

| Pair | Ratio |
|---|---|
| body text on paper | 18.4 |
| secondary text on paper | 7.9 |
| amber eyebrow on paper | 5.7 |
| amber-bright headline on ink | 8.1 |
| ink on amber-bright (buttons, chips, round headers) | 8.1 |
| ink on gold / silver / bronze (medals) | 6.4 / 5.7 / 5.0 |

The medals carry **ink** text, not paper. Paper on gold measured 2.88:1, which
fails at the 14px the badges use, and bronze was lightened from `#a2662f` to
`#b87333` to clear 4.5:1 against ink while still reading as bronze.

### The bracket

SPEC.md §11 names this the hard case and prescribes the fix: horizontal scroll
with a sticky round header, rather than trying to fit 8 entries on a phone.

Rounds are columns inside their own `overflow-x-auto` scroller, so the **page**
never scrolls sideways. Winners, losers and the grand final are three separate
scrollers — stacking all three into one grid at 390px is unreadable. Round
headers stick to the top of the scroller and name the stage (`W final`,
`L final`, `Final`, `Reset`) rather than only numbering it.

There are deliberately **no connector lines**. At this width they are either
hairlines nobody can see in sunlight or they crowd out the names, and the names
are the information; column position plus the bolded winner carries the shape.

Entry labels drop the word "Team" in bracket cells only — "Team Three — B" does
not fit a column and truncates to "Team Three …", losing the half that tells the
two entries apart. The colour swatch already says which team it is. Full labels
stay on the placings list and the match cards.

The grand-final reset is only played if the losers side wins the grand final, so
while it has no participants it reads "if needed" rather than "waiting" — a
finished game showing a match still waiting reads as an unfinished game.

### Looking at it with real data

```bash
npm run db:dry-run
```

Runs the draft to completion and then plays a whole three-day event from a fixed
seed: 13 picks in snake order, 6 games across all four formats, 32 matches, 30
played, one left live so the queue and the "you're up" banner have something in
them. Deterministic, so a rerun gives identical data.

The draft order comes from `lib/draft.ts`, not from anything invented in the
script, so the seeded board is the same snake order a live draft would produce —
position 4 ends up with picks 4, 5, 12 and 13, and five players.

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

## The queue and dashboard

The queue derives itself (SPEC.md §7.1) — nothing is stored except the one
manual override. Each station gets now playing / on deck / in the hole from the
match rows, so submitting a result advances the queue with no extra work: the
completed match drops out and newly-`READY` matches appear.

Only the match on deck can be started, and only when its station is free. §7.1
has now-playing as *the first match at each station*, so without that rule
tapping start on something further back would quietly promote it past another
team's game. To play out of order: bump it (admin only, audited), then start it.

Starting a match is open to the admin **or a captain playing in it** — §7.1 names
the admin, but the same reasoning §8 gives for distributing result submission
applies to tapping start.

`/` is the dashboard: the "you're up" banner with the station name, your next
matches across all games and days, the live queue, and a standings snapshot.

Polling is 10s on the dashboard and queue, 5s on the draft, and refetches
immediately on `visibilitychange` — phones suspend background tabs, and §7.3
calls that the most likely real-world bug in the app. Each tick pings
`/api/pulse` first, because `router.refresh()` cannot fail visibly and a page
going quietly stale is worse than an honest "reconnecting".

## Score entry that survives a dropped request

SPEC.md §8. A submission is written to `localStorage` before it is sent, retried
with backoff while the page is open, and a "not saved yet" badge stays up until
it lands — surviving a reload, because the queue is in storage rather than in
component state.

There is one store for the whole page, not one per match card: a bracket page
renders fifteen cards, and giving each its own queue and timer would have fifteen
timers racing to send the same entries.

A server *rejection* stops rather than retrying — "not your match" will never
succeed on a retry, and hiding it behind a permanent badge would be worse than
saying so. Only transport failures retry. No service worker or background sync;
SPEC.md §12 rejects those, partly because Safari has never implemented
Background Sync.

## Scoring, editing and undo

Results are reported by the admin or by either captain playing in the match
(SPEC.md §8), checked server-side per match. Every completed match is editable
and every result is undoable.

Undo is recursive: clearing a result clears the downstream slots it populated,
resets those matches, and — if a downstream match already had a result of its
own — undoes that first, because it was decided by a participant about to
disappear. Editing an early result cascades the same way.

Points never exist as a stored total. `game_results` holds one row per entry per
game and the leaderboard sums it at read time, applying each game's
`entry_aggregation` (SUM or BEST) there. That is why undo needs no arithmetic
unwound — SPEC.md §2.

The leaderboard sums `points_awarded` rather than recomputing, because round
robin pays by wins and the win count is not in `game_results`. Changing a game's
`points_matrix` or `points_per_win` therefore drops its results and reopens it —
the same rule as editing a match result — so a stale total is impossible.

**Round robin scores by wins, not placement** (SPEC.md §6.3). A round robin has
no ranked finish worth paying for, so it pays `points_per_win` for every win and
nothing for a loss: beating three teams is worth three times beating one. The
standings order is still recorded as a placement, so the game can say who won it
and the 1st/2nd-place tie-breakers keep working — but placement pays nothing.
`points_matrix` is unused for that format, and the admin form asks for whichever
field the chosen format actually uses.

Global tie-breakers run in SPEC.md §6.5 order: total points, 1st places, 2nd
places, round-robin head-to-head, then an admin override that requires a reason.
Head-to-head is a mini-table within each tied group rather than a pairwise
comparison — three teams can beat each other in a cycle, and sorting on a
non-transitive comparator gives an order nobody can explain.

## The tournament engine

Four formats, all generated as pure functions before anything touches the
database (SPEC.md §6):

| Format | Shape at the event |
|---|---|
| `DOUBLE_ELIM` | Beer pong: 8 entries, 15 matches, spans all 3 days |
| `SINGLE_ELIM` | A flip cup option: 4 entries, 3 matches |
| `ROUND_ROBIN` | A flip cup option: 4 entries, 6 matches |
| `RANKED_FFA` | One heat, admin assigns placement 1..N |

The whole bracket skeleton is built up front — every winners match, every losers
match, the grand final and its reset — with all advancement pointers wired at
generation time. Reporting a result is "write the entry into the target slot";
undo is "drop the result and replay". The bracket shape is never re-derived.

Flip cup's format is a runtime choice, not a build-time one: pick it in
`/admin/games` when you configure the game, and rebuild. Changing the format of
a scheduled game tells you to re-schedule, and re-scheduling refuses if any
match already has a result.

`npm test` covers this heavily — the engine is the highest-risk code in the
project. Includes a full 8-entry run asserting final placements and an undo of a
mid-bracket match asserting downstream slots cleared and nothing else touched.

## The draft

Snake order per SPEC.md §1.1: 13 picks over 4 teams, and position 4 takes pick
13 and ends with 5 players. That is intentional and self-balancing — do not
"fix" it. Pick 13 is permanently Mister Irrelevant, enforced by a generated
column so it cannot be edited away and clears itself if the pick is undone.

There is no clock, no auto-pick, and no draft-order randomizer (SPEC.md §12).

Once the draft is complete the draft page is the rosters-and-order view: each
team with its picks numbered, and the full pick history from #13 back to #1.
The Mister Irrelevant label appears on the roster row, in the pick history, and
on the profile card — SPEC.md §1.1 requires the first and last of those.

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

## Temporary: the Cloudflare demo

**This is disposable.** SPEC.md §16 is the spec, including the revert checklist.
It does not resolve SPEC.md §15.4, and it is not a candidate for running the
event — the `Dockerfile` already runs anywhere, and Cloudflare is the one host
that needs application changes to work at all.

Three pieces, only one of them Cloudflare's:

1. **Workers** runs the app, built by `@opennextjs/cloudflare`.
2. **A Postgres somewhere else** — Workers has no database.
3. **Migrations and seeding run from your laptop** against that database. No
   change to anything in `scripts/`.

### Prerequisites

- Node **22+** locally. Wrangler refuses to run on Node 20.
- A Cloudflare account (`npx wrangler login`).
- A Postgres with a **pooling** endpoint. On Neon that is the `-pooler` host.
  This is required, not a preference: see below.

### Deploy

```bash
nvm use 22
npx wrangler login
```

Push the three secrets. Generate **fresh** ones — do not reuse `.env`, which is
for a database on your laptop:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ADMIN_CREDENTIAL
```

Migrate and seed the remote database from your machine, then deploy:

```bash
DATABASE_URL='<direct, non-pooling url>' npm run db:migrate
DATABASE_URL='<direct, non-pooling url>' npm run db:demo
DATABASE_URL='<direct, non-pooling url>' npm run db:dry-run
npm run cf:deploy
```

Use the **direct** (non-pooling) URL for migrations and seeding, and the
**pooling** URL for the Worker secret.

### Getting in as admin once it is deployed

There is no admin PIN to look up. ADMIN comes from `players.is_admin`, so the
admin's **own magic link is their admin access** — and `/admin` then lists
everyone else's links and 6-digit codes.

To read the admin's link and code out of the deployed database. Put the URL
inline; the compose Postgres container is only being borrowed for its `psql`:

```bash
docker compose exec -T db psql '<direct url>' -tAc "select p.full_name||'  link=/join/'||c.token||'  code='||c.join_code from credentials c join players p on p.id=c.player_id where p.is_admin and c.revoked_at is null"
```

Do **not** write this as `DATABASE_URL='<url>' ... psql "$DATABASE_URL"`. The
shell expands `$DATABASE_URL` before the prefix assignment takes effect, so that
form silently queries whatever the variable already held — usually your local
database — and hands you a token that does not work on the deployed site.

`ADMIN_CREDENTIAL` is a different thing and is **not discoverable**: you choose
it, Cloudflare stores it write-only (`wrangler secret list` shows names, not
values), and `elevateToAdmin()` requires you to be signed in already, so it is
break-glass for a device that does not know it is the admin — not a login. If
you forget it, overwrite it with `npx wrangler secret put ADMIN_CREDENTIAL`.

To try it locally in `workerd` first, copy `.dev.vars.example` to `.dev.vars`
and run `npm run cf:preview`.

### What friends can see without signing in

SPEC.md §3.4 makes the app publicly readable with no cookie, so the bare URL is
enough to browse standings, brackets, the draft board and rosters. A magic link
is only needed to *do* anything — pick, start a match, or report a score. Send
the URL, not a link, unless you want someone acting as a specific player.

### Why the pooling endpoint is mandatory

Workers gives every request its own I/O context, and a socket opened for one
request may not be used by the next. A module-level `pg.Pool` that survives
between requests fails with "Cannot perform I/O on behalf of a different
request", so on Workers `lib/db/index.ts` builds a fresh single-connection pool
per `getDb()`. Connection reuse has to happen on the Postgres side instead.

Transaction-mode pooling is safe here: the only two row locks in the app
(`app/draft/actions.ts`, `lib/engine/submit.ts`) are both taken inside a
transaction, so they stay on one server connection for their whole life. That
was verified in `workerd`, not assumed — an admin undo of the beer pong grand
final committed correctly through a `select … for update`, cascading
`game_results` from 8 to 0 and reopening the game.

Hyperdrive is deliberately not used: its query cache defaults to a 60-second
TTL, and this app polls every 5–10 seconds and derives standings and the queue
at read time, so it would serve stale data. No R2 either — SPEC.md §12 rejects
it, and with every route `force-dynamic` there is nothing to cache.

### Costs and limits

The Worker bundles to **1.54 MB gzipped**, inside the 3 MB Workers Free limit,
so this fits the free plan. The Postgres provider is the part likely to have a
free-tier expiry — check before relying on the link staying up.

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
