# CLAUDE.md

Read `SPEC.md` before doing anything. It is the source of truth. If this file and SPEC.md disagree, SPEC.md wins.

## What this is

A mobile-first web app to run a 3-day beer Olympics: 17 players, 4 teams, an online snake draft, and a tournament engine across three game formats with a live "up next" queue. Single-use personal project for a specific event. Not a product.

## Ask, don't assume

**If SPEC.md is ambiguous or silent on something, stop and ask. Do not pick a plausible option and continue.**

This is the most important rule here. Open decisions are tracked in SPEC.md §15. If a task touches one of them and it's still unresolved, say so instead of choosing.

## Invariants — do not violate these

1. **Points are derived, never stored.** Standings and totals are always computed from `game_results` and match rows at read time. There is no `total_points` column that gets incremented. This is what makes undo work.
2. **No filesystem writes.** Player photos and team logos go to S3-compatible object storage. Never `/public`, never `/tmp`.
3. **No in-memory state across requests.** No module-level caches holding draft or queue state. All state lives in Postgres.
4. **No background workers, cron, or WebSockets.** All liveness comes from client polling. This keeps the app deployable to any container host.
5. **All auth goes through `identify()` in `lib/auth.ts`.** No route handler or component reads a token, PIN, or cookie directly.
6. **Server-side authorization is mandatory.** Never rely on a disabled button to prevent an action. Draft picks especially: verify the submitter is the current picker on the server.
7. **Scouting stats are decorative.** They never feed scoring, seeding, or matchmaking.

## Explicitly rejected — do not build or suggest

Each of these was considered and rejected for a stated reason in SPEC.md §12. Do not re-propose them.

- PWA, service workers, offline sync, IndexedDB, background sync
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

Local dev runs against the Postgres in `docker-compose.yml`. Run migrations and tests against it rather than reasoning about the schema abstractly.

## Working style

- **One phase per session.** Build order is SPEC.md §14. Don't work ahead.
- **Commit per task**, with a message naming the task.
- **The double-elimination engine is the highest-risk code in the project.** It runs across all three days of the event. Write tests for it before considering it done: a full 8-entry simulated run asserting correct final placements, and an undo of a mid-bracket match asserting downstream slots cleared. Run them.
- Don't refactor beyond the current task's scope.
- When you finish a task, say what you'd verify and how — don't just declare it done.

## Reality check

There is no staging environment and no second chance. This runs once, in a backyard, with 17 people who have been drinking, and the person administering it is one of them. Prefer boring and obvious over clever. Every destructive action needs an undo.
