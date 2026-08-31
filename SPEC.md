# SPEC.md — kfless games

Mobile-first web app to run a 3-day beer Olympics: 17 players, 4 teams, an online snake draft, and a multi-format tournament engine with a live "up next" queue.

This document is the source of truth. Where it conflicts with a suggestion from a coding assistant, this document wins. Anything not specified here should be raised as a question rather than invented.

---

## 1. Hard facts

These are settled. Do not build configurability around them beyond what is stated.

| Fact | Value |
|---|---|
| Players | Exactly 17 |
| Teams | Exactly 4 |
| Captains | 4 (one per team, included in the 17) |
| Draftable players | 13 (17 minus 4 captains) |
| Resulting rosters | 3 teams of 4, 1 team of 5 |
| Event length | 3 days |
| Drop-out risk | None — deposits collected |
| Native app | No |
| SMS | No |

Team counts and player counts should be read from the database, not hardcoded, but the app does not need to gracefully handle 9 teams or 60 players. Correctness at 4/17 is what matters.

### 1.1 Roster math

13 draft picks across 4 captains in snake order:

```
Round 1  picks  1– 4   order 1 → 4
Round 2  picks  5– 8   order 4 → 1
Round 3  picks  9–12   order 1 → 4
Round 4  pick  13      order 4 → 1  (only one pick occurs)
```

Pick 13 therefore belongs to the captain who picked 4th in round one, and that team ends with 5 players. This is intentional and self-balancing — do not "fix" it.

The player taken with pick 13 is permanently labeled **Mister Irrelevant** (after the NFL draft's final pick). This label is assigned automatically when the draft completes, is displayed on their profile card and roster row, and cannot be edited away.

---

## 2. Guiding principles

- **Outdoor legibility.** High contrast, large tap targets, large type. See §11 for the dark-mode decision.
- **Nothing to remember.** No passwords, no account creation, no email verification loops.
- **Derived, never mutated.** Standings, points, and rankings are always computed from match results at read time. Never store an incrementing `total_points` column that gets `+=`'d. This single rule is what makes undo work.
- **Everything is editable.** Assume every score will be entered wrong at least once by someone holding a drink.
- **Stateless app process.** See §10.

---

## 3. Authentication — DECIDED: per-person magic links with backup codes

### 3.1 The constraint

Build all auth behind a single module (`lib/auth.ts`) exposing exactly this interface, so the strategy can be swapped without touching feature code:

```
identify(request) -> { personId, teamId, role } | null
issueCredential(personId) -> string        // link or PIN
revokeCredential(personId) -> void
```

Every route handler and every server component asks `identify()` and nothing else. No feature code reads a PIN or a token directly.

### 3.2 Chosen strategy: per-person magic links

Given that all 17 emails are already in hand, this is the better option and the one being built:

- Each person gets a permanent, unguessable URL: `/join/<32-byte-random-token>`.
- Hitting that URL sets a signed, httpOnly cookie valid for **90 days** and redirects to the dashboard. One tap, forever.
- Tokens do **not** expire before the event ends. This is a party app; a "your link has expired" screen on Saturday night is a failure.
- **No email service is required.** The admin page lists all 17 people with a copy-link button and a "copy all as mailto" helper. Send them once, manually, from your own inbox. Adding Resend or SES later is optional, not a prerequisite.
- Every person is individually identified, which means the audit log (§8) and the draft history are meaningful for free.

**Fallback for the day-of:** the admin page also shows a per-person 6-digit code. If someone can't find their email while standing in the yard, they enter the code at `/join` and get the same cookie. Codes are stored in plaintext deliberately so the admin can read them aloud — the threat model here is a friend being annoying, not an attacker.

### 3.4 Required regardless of strategy

- Rate limit credential submission: 5 attempts per IP, then exponential backoff. This matters more than credential length.
- Never place a token, PIN, or code in a URL query string — only in a path segment (magic link) or a POST body. Query strings end up in logs, browser history, and screenshots.
- Roles: `ADMIN`, `CAPTAIN`, `PLAYER`. Anyone with no cookie is `PUBLIC` and gets read-only access to everything except the admin console and the draft-pick action.

---

## 4. Data model

Postgres via Drizzle. Names below are indicative; keep them or improve them consistently.

### 4.1 `players`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `full_name` | text | |
| `nickname` | text null | |
| `email` | text | used for credential delivery |
| `team_id` | uuid null fk | null until drafted |
| `is_captain` | bool | |
| `draft_pick_number` | int null | 1–13; null for captains |
| `is_mister_irrelevant` | bool | derived: `draft_pick_number = 13` |
| `photo_url` | text null | see §9 |
| `profile_complete` | bool | |

Biographical, all nullable, all self-entered:
`height`, `weight`, `hometown`, `college`, `preferred_beverage`, `signature_celebration`, `walkout_song`, `scouting_report` (free text, written by the player about themselves).

Scouting ratings, integers 1–100, all nullable, all self-entered:
`beer_pong`, `chugging`, `flip_cup`, `endurance`, `clutch`, `trash_talk`, `hand_eye`, `recovery`.

Plus `personal_record_beers` (int null).

These stats are decorative. **They must not feed into any scoring, seeding, or matchmaking logic.** They exist to make draft cards fun.

### 4.2 `teams`

`id`, `name` (editable by captain), `logo_url` (nullable, editable by captain), `color_hex`, `motto`, `captain_id`, `draft_position` (1–4, set manually by admin).

No points column. Points are always computed.

### 4.3 `games`

| Column | Notes |
|---|---|
| `id` | |
| `name` | e.g. "Beer Pong" |
| `rules` | markdown text |
| `format` | `DOUBLE_ELIM` \| `ROUND_ROBIN` \| `RANKED_FFA` |
| `entries_per_team` | int, default 1. Beer pong = 2. |
| `entry_size` | int null — players per entry, informational only (beer pong = 2) |
| `points_matrix` | jsonb, placement → points, e.g. `{"1":100,"2":70,"3":50,"4":30}` |
| `entry_aggregation` | `SUM` \| `BEST` — how multiple entries from one team combine. Default `SUM`. |
| `scheduled_day` | int 1–3, nullable |
| `sort_order` | int |
| `station` | text null, e.g. "Pong Table — Patio" |
| `status` | `DRAFT` \| `SCHEDULED` \| `ACTIVE` \| `COMPLETE` |
| `spans_multiple_days` | bool — beer pong is `true` |

Admin can create, edit, reorder, and delete games at any time. Deleting a game with recorded results requires a confirmation and is logged.

### 4.4 `entries`

The unit that actually competes. **This table was missing from the previous spec and is the most important structural fix.**

`id`, `game_id`, `team_id`, `label` (e.g. "Team 3 — Pair A"), `seed` (int null), `player_ids` (uuid array, nullable).

- A `ROUND_ROBIN` or `RANKED_FFA` game where the whole team plays generates 1 entry per team (4 entries).
- Beer pong generates 2 entries per team (8 entries).
- Entries are generated when the admin sets a game to `SCHEDULED`.
- Captains may optionally assign which of their players fill each entry. Not required.

### 4.5 `matches`

`id`, `game_id`, `round` (int), `bracket` (`WINNERS` | `LOSERS` | `GRAND_FINAL` | `RR` | `HEAT`), `slot` (int, position within round), `status` (`PENDING` | `READY` | `IN_PROGRESS` | `COMPLETE`), `station` (text null), `queue_position` (int null), `completed_at`.

Advancement pointers, for brackets only:
`winner_to_match_id`, `winner_to_slot`, `loser_to_match_id`, `loser_to_slot`.

### 4.6 `match_participants`

`id`, `match_id`, `entry_id` (nullable — empty bracket slots), `slot` (int), `score` (int null), `rank` (int null), `is_winner` (bool null).

Using a participants table rather than `participant_a` / `participant_b` is deliberate: it lets a 2-player bracket match and a 4-entry FFA heat share one code path.

### 4.7 `game_results`

Final placement per entry per game. Written when a game is marked `COMPLETE`.

`id`, `game_id`, `entry_id`, `placement` (int), `points_awarded` (int).

This is the only input to the leaderboard.

### 4.8 `audit_log`

`id`, `timestamp`, `actor_person_id`, `actor_role`, `action` (text), `target_type`, `target_id`, `before` (jsonb), `after` (jsonb).

Log every score submission, score edit, undo, draft pick, draft undo, game create/delete, and team name/logo change. Viewable by admin.

---

## 5. The draft

### 5.1 Setup

Admin manually enters the pick order (1–4) for the four captains. **Do not build a randomizer.** The order is decided offline.

Admin sets draft status: `NOT_STARTED` → `LIVE` → `COMPLETE`.

### 5.2 Mechanics

- Snake order per §1.1, computed from `draft_position` and the number of remaining picks.
- **Exactly one captain can pick at a time.** All other captains see a read-only board with "waiting on <name>".
- **No clock.** No timers, no auto-pick, no forfeit.
- The picking captain's device shows an enabled `DRAFT` button on each available player card; everyone else's is disabled.
- Server-side enforcement is mandatory: reject any pick where the submitting person is not the current picker, or where the player is already drafted. Do not rely on the UI to prevent this.
- The draft page polls every 5 seconds while `LIVE` (faster than the event-day 10s, since people are staring at it).

### 5.3 Draft board UI

- **On the clock:** current captain, pick number, round.
- **Up next:** the following 3 picks.
- **Player pool:** searchable/sortable cards showing photo, name, nickname, and scouting ratings.
- **Pick history:** reverse-chronological, with who picked whom and when.
- **Team panels:** the 4 rosters filling up live.

### 5.4 Admin controls

- Pick on behalf of any captain.
- **Undo last pick** — removes the pick, clears `draft_pick_number`, returns the player to the pool, rewinds the turn. Logged.
- Pause / resume the draft.

On transition to `COMPLETE`, set `is_mister_irrelevant` on pick 13.

---

## 6. Tournament engine

Three formats. Each is a generator plus a result handler.

### 6.1 `DOUBLE_ELIM`

The hardest piece. Build it carefully; beer pong runs across all three days.

**Generation.** Given N entries (beer pong: 8), pre-generate the *entire* bracket skeleton up front — every winners match, every losers match, the grand final, and a grand-final reset match. Matches start with null participants and `status = PENDING`. Wire every `winner_to_match_id` / `loser_to_match_id` pointer at generation time.

This is the key design choice. Because the graph is fully built in advance, reporting a result is just "write the participant into the target slot," and undo is just "clear the target slots." No re-derivation of bracket shape ever happens.

**Seeding.** With 8 entries from 4 teams, **two entries from the same team must not meet in round 1.** Seed so that Team A's two entries land in opposite halves of the bracket. Same-team matchups later are fine and encouraged.

**Byes.** If N is not a power of two, top seeds receive round-1 byes. A bye auto-completes: the entry advances immediately and no match appears in the queue. (Not needed at 8, but flip cup may land here.)

**Grand final reset.** If the losers-bracket entry wins the grand final, the reset match activates. Do not skip this.

**Match readiness.** A match becomes `READY` when all its participant slots are filled. Only `READY` matches enter the queue.

**Placement.** Final placements derive from elimination order: last remaining = 1st, grand final loser = 2nd, and so on down through the losers bracket.

### 6.2 `ROUND_ROBIN`

- Every entry plays every other entry once. With 4 entries: 6 matches.
- Standings table: Wins, Losses, Cup/Point Differential.
- Tie-breakers in order: (1) head-to-head record, (2) differential, (3) coin flip prompt shown to the admin.
- Placement = standings order.

### 6.3 `RANKED_FFA`

- All entries compete simultaneously. One heat by default; the model supports multiple heats but V1 UI need only handle one.
- Admin assigns placement 1..N via a drag-to-reorder list.
- Optional `raw_score` per entry (a time, a count) shown alongside but not used for ordering.

### 6.4 Scoring

When a game is marked `COMPLETE`:

1. Compute placement per entry.
2. Look up `points_matrix[placement]` for each entry.
3. Write one `game_results` row per entry.
4. For teams with multiple entries, apply `entry_aggregation` at read time — do not pre-aggregate into a stored column.

**There is no format-based weighting.** A game is worth whatever its `points_matrix` says. If beer pong should matter more, the admin gives it a bigger matrix. One system, not two.

**Global tie-breakers**, in order: (1) total points, (2) number of 1st-place finishes, (3) number of 2nd-place finishes, (4) head-to-head in round-robin games, (5) admin manual override with a required reason string.

---

## 7. The queue

The reason the app exists. Beer pong alone will produce ~14 matches spread over three days, interleaved with everything else.

### 7.1 Auto-advancing queue

**The admin must not have to drag matches around for three days.** The queue derives itself:

- Each station has an ordered list of `READY` matches for the games assigned to it, ordered by `round` then `slot`.
- `NOW_PLAYING` = the first match at each station, once the admin taps "start."
- `ON_DECK` = the next `READY` match at that station.
- `IN THE HOLE` = the one after that.
- When a result is submitted, the match goes `COMPLETE`, downstream slots populate, newly-`READY` matches appear, and the queue advances automatically.

Admin retains a manual override to bump any match to the front of a station's queue.

### 7.2 Player dashboard

The default landing page for anyone with a cookie.

- **"You're up" banner** — large, unmissable, when the signed-in player's team (or entry) is `NOW_PLAYING` or `ON_DECK`. Includes the station name.
- **My next matches** — this player's team's upcoming matches across all games and days.
- **Live queue** — all stations, showing now playing / on deck / in the hole.
- **Standings snapshot** — top-line team points.

### 7.3 Polling

- 10-second interval on the dashboard and queue; 5 seconds on the draft page.
- **Refetch immediately on `visibilitychange` when the tab becomes visible.** Phones suspend background tabs, so a returning user would otherwise see stale data. This is the most likely real-world bug in the whole app.
- Show a "last updated Xs ago" indicator and a reconnecting state on failure. Stale data presented as current is worse than an honest error.

---

## 8. Scoring, editing, undo

- **Who can submit:** admin, plus either captain involved in a match. Distributing this matters — one person entering every result for three days is a single point of failure, and that person wants to be drinking.
- Every submission records the submitter in `audit_log`.
- **Every completed match is editable.** Tap it, change the result, save.
- **Undo:** clears the match result, recursively clears downstream bracket slots that were populated by it, resets those matches to `PENDING`, and removes the match from the queue's completed set.
- Because points are computed from `game_results` and standings from match rows, no points arithmetic needs unwinding. This is the payoff for the "derived, never mutated" rule.
- Editing a result after a game is `COMPLETE` requires the admin to re-mark the game complete, which recomputes `game_results`.
- **Score entry must survive a dropped request:** hold the form state in `localStorage`, retry the POST on failure, and show a persistent "not saved yet" badge until it succeeds. This is the entire offline story (see §12).

---

## 9. Profiles, logos, uploads

### 9.1 Self-service profiles

Each player fills in their own bio, ratings, and scouting report from their dashboard. The admin does not enter 17 profiles by hand. Admin can see a completion checklist and edit anyone's profile.

Profiles should be open for editing before the draft so the scouting cards are populated when it matters.

### 9.2 Team identity

Captains can edit their **team name** and upload a **team logo** at any time. Both changes are logged. Team name is used everywhere the team appears; the logo appears on rosters, brackets, standings, and the queue.

### 9.3 File uploads

Player photos, team logos, and the central event logo.

- **Uploads go to object storage, never the local filesystem.** DO Spaces or Cloudflare R2 (both S3-compatible; use `@aws-sdk/client-s3`). Writing to `/public` breaks on every container host and on Vercel.
- The event logo is a static asset in the repo and may live in `/public`.
- Accept JPEG/PNG/WebP, cap at 5 MB, resize server-side to max 800px, store the URL.

---

## 10. Stack and deployment

- **Framework:** Next.js (App Router), TypeScript, Tailwind.
- **Database:** PostgreSQL. **Drizzle** for schema and migrations.
- **API:** Next.js route handlers. **No separate backend. No AWS Lambda.** Generating a bracket for 8 entries is microseconds of work; there is nothing to offload.
- **No Supabase.** It does not provide PIN auth or offline sync out of the box, so it buys nothing here and adds a dependency.
- **Email:** none required (see §3.2). If added later, Resend.

### 10.1 Containerized, host-agnostic

Ship a `Dockerfile` and a `docker-compose.yml`.

- Multi-stage build on `node:22-alpine`.
- **Set `output: 'standalone'` in `next.config.js`.** This takes the image from roughly 1 GB to roughly 150 MB. Without it, deploys are slow and painful.
- `docker-compose.yml` runs the app plus a Postgres service for local development, so migrations and queries are exercised against a real database.

This keeps DO App Platform, a DO Droplet, Fly, Render, Railway, and Cloud Run all available. **Note that Vercel ignores the Dockerfile** — it builds from source with its own pipeline. That path stays open too, but only as long as the constraints below hold.

### 10.2 Stateless constraints — do not violate

These are what keep every host viable:

- No writes to the local filesystem. Uploads go to object storage.
- No in-memory state that assumes a single long-lived process (no module-level caches holding draft state, no in-process queues).
- No background workers, cron loops, or custom WebSocket server. All liveness comes from client polling.
- All state lives in Postgres.

### 10.3 Environment

`DATABASE_URL`, `SESSION_SECRET`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `ADMIN_CREDENTIAL`.

---

## 11. UI

Detailed styling is deferred; the following are structural requirements.

- **Mobile-first.** Design at 390px width and scale up. The bracket view is the hard case — use horizontal scroll with a sticky round header rather than trying to fit 8 entries on a phone screen.
- **Light, very high-contrast theme by default.** This overrides the earlier dark-mode recommendation, which was wrong for the use case: dark themes wash out badly in direct sunlight, and outdoors the screen will be at maximum brightness anyway, which dominates battery draw far more than pixel color does. A dark mode toggle is welcome as a nice-to-have; it must not be the default.
- **Bottom nav (4 items):** Queue · Games & Standings · Draft & Rosters · Me. Admin is a separate gated route, not a nav item.
- Every team appears with its logo and color wherever it's named.
- Tap targets ≥ 44px. Assume unsteady hands.

---

## 12. Explicitly out of scope

Do not build these. Each was considered and rejected.

- **PWA, service workers, offline sync, IndexedDB, background sync.** The headline benefit — queue a score offline and background-sync it later — **does not work on iOS**, where Safari has never implemented the Background Sync API. Most guests will be on iPhones. It would be the most bug-prone code in the project, nearly impossible to test before the event, and it would produce stale-data-presented-as-live, which is worse than an honest offline banner. The `localStorage` retry in §8 covers the realistic failure mode, which is a dropped request, not a two-hour outage. Bring paper scorecards as the real backup.
- Native mobile apps.
- SMS / Twilio / push notifications.
- Email/password accounts, OAuth, social login, password resets.
- Payments.
- A draft clock, auto-pick, or draft-order randomizer.
- Format-based automatic point weighting (see §6.4).
- Bench/rotation logic for the 5-player team. The 5th player subs in freely; nobody will audit this.
- Real-time WebSockets. Polling is sufficient at this scale and keeps the app stateless.

---

## 13. Known games

The game list is intentionally admin-managed and incomplete. Confirmed so far:

| Game | Format | Entries/team | Notes |
|---|---|---|---|
| Beer Pong | `DOUBLE_ELIM` | 2 | 8 entries. Spans all 3 days. **The primary driver of the queue system.** |
| Flip Cup | `ROUND_ROBIN` or `DOUBLE_ELIM` — TBD | 1 | Whole team |
| TBD relay(s) | `RANKED_FFA` | 1 | All teams at once, ranked finish |
| Several others | mostly `ROUND_ROBIN` | 1 | Every team plays every other once |

Build and test the engine against these three formats. Seed the development database with beer pong (8 entries, double elim) as the primary test case, since it exercises byes, same-team seeding, losers-bracket routing, the grand-final reset, undo, and multi-day queueing all at once.

---

## 14. Build order

Each phase should be independently verifiable.

**Phase 0 — Skeleton.** Next.js + Tailwind + Drizzle + Docker + docker-compose with Postgres. Migrations run. `output: 'standalone'` set. Deploys to the chosen host with a hello-world page.

**Phase 1 — Data and auth.** All tables. Seed script with 17 real names and 4 teams. Auth module per §3 with the chosen strategy behind the `identify()` interface. Admin console shell with credential list.

**Phase 2 — Profiles and teams.** Self-service profile editing, photo upload to object storage, captain team name + logo editing. Verifiable: a player can fill in their own card end to end and it renders.

**Phase 3 — Draft.** Snake order computation, single-picker enforcement (server-side), draft board, pick history, admin override and undo, Mister Irrelevant assignment. Verifiable: 13 picks complete correctly and pick 13 gets the label.

**Phase 4 — Engine.** All three generators. Double elim first and most carefully: pre-generated skeleton, wired pointers, same-team seed separation, grand final reset. Verifiable: 8 entries produce a mathematically correct bracket, and a full simulated run-through crowns the right winner.

**Phase 5 — Scoring, editing, undo.** Result submission by admin or either captain, edit, recursive undo, `game_results`, computed leaderboard with tie-breakers, audit log. Verifiable: undoing a mid-bracket match cleanly reverts downstream state and standings.

**Phase 6 — Queue and dashboard.** Auto-advancing station queues, "you're up" banner, polling with `visibilitychange` refetch, `localStorage` score-entry retry.

**Phase 7 — Polish.** Styling, logos, bracket layout on mobile, empty states, a dry run with fake results across all three days.

---

## 15. Open decisions

1. ~~**Auth strategy**~~ — RESOLVED: per-person magic links with the 6-digit
   day-of backup codes. The shared-team-PIN alternative was removed from §3.
   ADMIN comes from a `players.is_admin` flag, so the admin's own magic link
   grants it; `ADMIN_CREDENTIAL` remains as a break-glass elevation for an
   already-identified person, which keeps `audit_log.actor_person_id` populated.
2. **Flip cup format** — round robin or double elimination.
3. **Remaining game list** and each game's `points_matrix`.
4. **Host** — DO App Platform vs. DO Droplet. Does not affect application code.
