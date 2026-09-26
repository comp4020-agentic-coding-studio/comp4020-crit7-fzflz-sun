import { sql } from "drizzle-orm";
import { int, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

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

// A real login account. `loginEnabled = 0` marks a historical placeholder
// (see src/lib/seed.ts's upgrade path) that exists only so old allocation
// rows still resolve to a real user — it can never authenticate.
export const users = sqliteTable("users", {
  id: int().primaryKey({ autoIncrement: true }),
  username: text().notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  loginEnabled: int("login_enabled").notNull().default(1),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Login sessions — named auth_sessions, deliberately distinct from the
// `sessions` table above (which models class meeting times, not logins).
// The browser only ever holds the random token; this table holds only its
// SHA-256 hash, so reading this table never yields a usable session (see
// src/lib/auth.ts and docs/DATABASE.md).
export const authSessions = sqliteTable("auth_sessions", {
  id: int().primaryKey({ autoIncrement: true }),
  userId: int("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Which courses a student is enrolled in — this round only ever written at
// seed time (see CLAUDE.md); a full registration UI is out of scope.
export const enrolments = sqliteTable(
  "enrolments",
  {
    id: int().primaryKey({ autoIncrement: true }),
    userId: int("user_id")
      .notNull()
      .references(() => users.id),
    courseId: int("course_id")
      .notNull()
      .references(() => courses.id),
  },
  (table) => [unique().on(table.userId, table.courseId)],
);

// Named, ordered seed/upgrade steps (see src/lib/seed.ts) each get one row
// here once applied, so re-running the app against an already-populated
// database — including an old pre-multi-user volume — never repeats a step:
// no duplicated courses/users/sessions, and no silently-restored allocation
// after a student has cancelled one of their starting picks.
export const seedState = sqliteTable("seed_state", {
  key: text().primaryKey(),
  appliedAt: text("applied_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// One row per (student, activity group): `studentId` is the real per-user
// identity going forward, enforced unique with activityGroupId below —
// the database-level guarantee that a student can hold at most one session
// per activity group, independent of anything the UI happens to prevent.
//
// `legacyUserId` is the original pre-auth text identity column
// (`demo-student` / `seed-student-N`, see the pre-multi-user history of this
// file). It is kept, unchanged, only because it was NOT NULL before this
// change and SQLite can't relax that without rebuilding the table; it is not
// read by any app code after the multi-user upgrade, and new rows just carry
// the allocating user's username in it for the same historical-shape reason.
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
    legacyUserId: text("user_id").notNull(),
    studentId: int("student_id").references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    unique().on(table.legacyUserId, table.activityGroupId),
    unique().on(table.studentId, table.activityGroupId),
  ],
);

export type Course = typeof courses.$inferSelect;
export type ActivityGroup = typeof activityGroups.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type User = typeof users.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
export type Enrolment = typeof enrolments.$inferSelect;
export type Allocation = typeof allocations.$inferSelect;
