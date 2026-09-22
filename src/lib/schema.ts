import { sql } from "drizzle-orm";
import { int, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

// One demo student drives every allocation in this prototype — no login, no
// real ANU API, see CLAUDE.md / spec/brief.md for why that's out of scope.
export const DEMO_USER_ID = "demo-student";

// The schema is the ground truth for the database. To change it: edit here,
// run `pnpm db:generate` to turn the diff into a migration under drizzle/,
// and commit both — the migration applies automatically when the server
// boots (see src/lib/db.ts), locally and deployed. Never edit the database
// by hand: state on the deployed volume outlives every deploy, and the
// migration trail is what keeps old state and new code compatible.
export const courses = sqliteTable("courses", {
  id: int().primaryKey({ autoIncrement: true }),
  code: text().notNull(),
  name: text().notNull(),
  color: text().notNull(),
});

export const activityGroups = sqliteTable("activity_groups", {
  id: int().primaryKey({ autoIncrement: true }),
  courseId: int("course_id")
    .notNull()
    .references(() => courses.id),
  activityType: text("activity_type").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: int().primaryKey({ autoIncrement: true }),
  activityGroupId: int("activity_group_id")
    .notNull()
    .references(() => activityGroups.id),
  // 0 = Monday .. 4 = Friday
  dayOfWeek: int("day_of_week").notNull(),
  startMinutes: int("start_minutes").notNull(),
  endMinutes: int("end_minutes").notNull(),
  location: text().notNull(),
  capacity: int().notNull(),
});

// One row per (user, activity group): the unique index is the database-level
// guarantee that a student can hold at most one session per activity group,
// independent of anything the UI happens to prevent.
export const allocations = sqliteTable(
  "allocations",
  {
    id: int().primaryKey({ autoIncrement: true }),
    sessionId: int("session_id")
      .notNull()
      .references(() => sessions.id),
    activityGroupId: int("activity_group_id")
      .notNull()
      .references(() => activityGroups.id),
    userId: text("user_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [unique().on(table.userId, table.activityGroupId)],
);

export type Course = typeof courses.$inferSelect;
export type ActivityGroup = typeof activityGroups.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Allocation = typeof allocations.$inferSelect;
