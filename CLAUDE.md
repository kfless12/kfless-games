# CLAUDE.md

Read `SPEC.md` before doing anything. It is the source of truth. If this file and SPEC.md disagree, SPEC.md wins.

## What this is

A mobile-first web app to run a 3-day beer Olympics: 17 players, 4 teams, an online snake draft, and a tournament engine across three game formats with a live "up next" queue. Single-use personal project for a specific event. Not a product.

## Ask, don't assume

**If SPEC.md is ambiguous or silent on something, stop and ask. Do not pick a plausible option and continue.**

This is the most important rule here. Open decisions are tracked in SPEC.md §15. If a task touches one of them and it's still unresolved, say so instead of choosing.

## Invariants — do not violate these

1. **Points are derived, never stored.** Standings and totals are always computed from `game_results` and match rows at read time. There is no `total_points` column that gets incremented. This is what makes undo work.
2. **No filesystem writes.** Player photos and team logos are stored as `bytea` in Postgres and served from `/api/images/<id>`. Never `/public`, never `/tmp`. See SPEC.md §9.3 — object storage was considered and reversed after measuring the actual image sizes.
3. **No in-memory state across requests.** No module-level caches holding draft or queue state. All state lives in Postgres.
4. **No background workers, cron, or WebSockets.** All liveness comes from client polling. This keeps the app deployable to any container host.
5. **All auth goes through `identify()` in `lib/auth.ts`.** No route handler or component reads a token, PIN, or cookie directly.
6. **Server-side authorization is mandatory.** Never rely on a disabled button to prevent an action. Draft picks especially: verify the submitter is the current picker on the server.
7. **Scouting stats are decorative.** They never feed scoring, seeding, or matchmaking.

## Explicitly rejected — do not build or suggest

Each of these was considered and rejected for a stated reason in SPEC.md §12. Do not re-propose them.

- PWA, service workers, offline sync, IndexedDB, background sync
- S3-compatible object storage, `@aws-sdk/client-s3`, and server-side image processing libraries like `sharp`
- Native apps, SMS, push notifications
- Email/password accounts, OAuth, NextAuth
- Supabase, AWS Lambda, any separate backend service
- A draft clock, auto-pick, or draft-order randomizer
- Format-based automatic point weighting
- Bench/rotation logic for the 5-player team
- Dark mode as the default (light high-contrast is correct — the event is outdoors in daylight)

## Stack

Next.js App Router · TypeScript · Tailwind · PostgreSQL · Drizzle · Docker.

`output: 'standalone'` must stay set in `next.config.js`.

**There is a temporary Cloudflare Workers demo host — SPEC.md §16.** It is built
to be deleted and it does not resolve §15.4. Everything it touches is marked
`TEMPORARY — SPEC.md §16` in a comment, and §16.4 is the revert checklist. Do
not build on it, do not extend it, and do not treat Workers as a constraint when
writing application code: the container path is the real one. If a task would
make the Workers branch load-bearing, stop and ask.

Local dev runs against the Postgres in `docker-compose.yml`. Run migrations and tests against it rather than reasoning about the schema abstractly.

## Testing

Not chasing coverage. The point is narrow: complex logic must not break silently
when a later phase touches it. `npm test` uses Node's built-in test runner
through `tsx` — no test framework dependency.

```bash
npm test          # everything, including the database tests
npm run test:unit # pure logic only, no database needed
npm run test:watch
```

**Test it if it has any of these:**

- Non-obvious branching or arithmetic — the double-elimination engine, snake
  order, points aggregation, tie-breakers, rate-limit backoff.
- Security consequences — cookie signing and tamper rejection, role resolution,
  the server-side authorization check on an action.
- Undo. Undo is the safety net for the whole event; if it breaks, three days of
  results are silently wrong.
- A database invariant the code leans on — a check constraint, a generated
  column. TypeScript cannot see these, and a later migration can quietly drop
  one.
- A bug you just fixed. Add the test that would have caught it.

**Don't bother:**

- Layout, styling, copy.
- Straight-line CRUD with no branching.
- Framework behaviour — that Next sets a cookie, that Drizzle emits SQL.
- Anything needing a browser driver. No Playwright, no Cypress. Verify UI by
  running the app and looking at it.

**How to write them:**

- Tests sit next to the code as `*.test.ts`.
- Keep pure logic in modules that do not import `next/headers`, so it stays
  testable outside a request. `lib/session.ts` and `lib/rate-limit.ts` are the
  pattern: `lib/auth.ts` is a thin adapter over them, and its public surface
  stays as narrow as SPEC.md §3.1 demands.
- Database tests run against the docker-compose Postgres, inside a transaction
  that always rolls back. Never point them at a database holding real event
  data.
- Assert the transition, not just the end state. A test that passes when the
  value is always `false` is not a test.
- After writing a test, break the thing it covers and confirm the test fails.
  A green test that never bites is worse than no test, because it buys
  confidence it has not earned.

**`npm test` must pass before a phase is done.** Report the actual counts, not
"tests pass".

## Working style

- **One phase per session.** Build order is SPEC.md §14. Don't work ahead.
- **Commit per task**, with a message naming the task.
- **The double-elimination engine is the highest-risk code in the project.** It runs across all three days of the event. Write tests for it before considering it done: a full 8-entry simulated run asserting correct final placements, and an undo of a mid-bracket match asserting downstream slots cleared. Run them.
- Don't refactor beyond the current task's scope.
- When you finish a task, say what you'd verify and how — don't just declare it done.

## Reality check

There is no staging environment and no second chance. This runs once, in a backyard, with 17 people who have been drinking, and the person administering it is one of them. Prefer boring and obvious over clever. Every destructive action needs an undo.
