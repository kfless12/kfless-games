import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * PHASE 0 SCAFFOLDING — NOT PART OF THE DOMAIN MODEL.
 *
 * SPEC.md §14 gives Phase 0 the goal "migrations run" and gives Phase 1 the
 * goal "all tables". This table exists only so there is a migration to run and
 * so the hello-world page can prove a real round trip to a real Postgres.
 *
 * Delete it in Phase 1 (with a migration) when the tables in SPEC.md §4 land.
 * Nothing else should ever read or write it.
 */
export const appHealth = pgTable('app_health', {
  id: uuid('id').primaryKey().defaultRandom(),
  note: text('note').notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
});
