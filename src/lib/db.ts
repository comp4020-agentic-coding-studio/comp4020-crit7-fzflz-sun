import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { runSeed } from "./seed";
import { activityGroups, allocations, courses, enrolments, sessions, users } from "./schema";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload and a redeploy; locally it defaults to an
// untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

// Exported so a test can check the pragma actually took on this connection
// (it's per-connection, not persisted in the file, so a second connection
// opened separately would tell you nothing about this one).
export const client = new Database(path);
client.pragma("journal_mode = WAL");
// better-sqlite3 does not turn this on by default, so the `references()`
// calls in schema.ts are decoration, not enforcement, until this runs.
client.pragma("foreign_keys = ON");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume — the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`,
// commit the migration it writes to drizzle/.
migrate(db, { migrationsFolder: "./drizzle" });
// Idempotent, versioned seed/upgrade steps — see src/lib/seed.ts and
// docs/DATABASE.md. Safe to run against an empty database or an
// already-populated one (including the original single-user shape): each
// step is guarded by a seed_state marker so nothing is duplicated and no
// cancelled allocation is silently restored on a later restart.
runSeed(db);

export type SessionCard = {
  id: number;
  activityGroupId: number;
  courseCode: string;
  courseColor: string;
  activityType: string;
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
  location: string;
  capacity: number;
  allocatedCount: number;
  allocatedByMe: boolean;
  status: "allocated" | "available" | "full";
};

// Once an activity group has an allocation, its other candidates (available
// or full) are no longer real choices for this student — showing them next
// to the picked session is exactly the "map between timetable and options
// table" friction this prototype exists to remove. So a group with a pick
// shows only that session; a group with no pick shows every candidate. This
// runs per caller, against their own `allocatedByMe` flag — two students
// looking at the same activity group can see different things.
function visibleForGroup(groupSessions: SessionCard[]): SessionCard[] {
  const picked = groupSessions.find((s) => s.allocatedByMe);
  return picked ? [picked] : groupSessions;
}

// Only sessions belonging to a course the caller is enrolled in are ever
// returned — enforced by the inner join on enrolments below, not filtered
// out afterwards, so there's no path that accidentally leaks another
// course's candidates. Capacity (`allocatedCount`) is still computed across
// *every* student's allocations: seats are a shared resource, visibility
// isn't.
export function listTimetable(studentId: number): SessionCard[] {
  const rows = db
    .select({
      id: sessions.id,
      activityGroupId: sessions.activityGroupId,
      courseCode: courses.code,
      courseColor: courses.color,
      activityType: activityGroups.activityType,
      dayOfWeek: sessions.dayOfWeek,
      startMinutes: sessions.startMinutes,
      endMinutes: sessions.endMinutes,
      location: sessions.location,
      capacity: sessions.capacity,
      allocatedCount: sql<number>`(select count(*) from ${allocations} where ${allocations.sessionId} = ${sessions.id})`,
      mine: sql<number>`(select count(*) from ${allocations} where ${allocations.sessionId} = ${sessions.id} and ${allocations.studentId} = ${studentId})`,
    })
    .from(sessions)
    .innerJoin(activityGroups, eq(sessions.activityGroupId, activityGroups.id))
    .innerJoin(courses, eq(activityGroups.courseId, courses.id))
    .innerJoin(
      enrolments,
      and(eq(enrolments.courseId, courses.id), eq(enrolments.userId, studentId)),
    )
    .orderBy(sessions.dayOfWeek, sessions.startMinutes)
    .all();

  const cards: SessionCard[] = rows.map(({ mine, ...row }) => ({
    ...row,
    allocatedByMe: mine > 0,
    status: mine > 0 ? "allocated" : row.allocatedCount >= row.capacity ? "full" : "available",
  }));

  const byGroup = new Map<number, SessionCard[]>();
  for (const card of cards) {
    const group = byGroup.get(card.activityGroupId);
    if (group) group.push(card);
    else byGroup.set(card.activityGroupId, [card]);
  }

  return [...byGroup.values()].flatMap(visibleForGroup);
}

export class AllocationError extends Error {}

// At most one allocation per (student, activity group), enforced here and
// backed by the DB's unique index on (student_id, activity_group_id).
// Picking a *different* session while one is already held is refused rather
// than silently swapped — the UI's own contract is "cancel your current
// pick, then choose another," so the two don't collapse into one request.
// Picking the session you already hold is a no-op, not an error: the click
// that got you here looks the same either way.
//
// Enrolment, uniqueness-in-group and capacity are all checked inside this
// one db.transaction(), which better-sqlite3 (and this whole call) runs
// fully synchronously — Node's single-threaded event loop can't interleave
// another request's JS in the middle of it, so two students racing for the
// last seat can't both read "one seat free" before either writes: whichever
// call's synchronous body runs first commits the seat, the second sees the
// now-updated count and gets "full".
export function allocateSession(studentId: number, sessionId: number): void {
  db.transaction((tx) => {
    const session = tx
      .select({
        id: sessions.id,
        activityGroupId: sessions.activityGroupId,
        capacity: sessions.capacity,
        courseId: activityGroups.courseId,
      })
      .from(sessions)
      .innerJoin(activityGroups, eq(sessions.activityGroupId, activityGroups.id))
      .where(eq(sessions.id, sessionId))
      .get();
    if (!session) throw new AllocationError("not-found");

    const enrolled = tx
      .select()
      .from(enrolments)
      .where(and(eq(enrolments.userId, studentId), eq(enrolments.courseId, session.courseId)))
      .get();
    if (!enrolled) throw new AllocationError("not-enrolled");

    const currentInGroup = tx
      .select()
      .from(allocations)
      .where(
        and(
          eq(allocations.activityGroupId, session.activityGroupId),
          eq(allocations.studentId, studentId),
        ),
      )
      .get();

    if (currentInGroup) {
      if (currentInGroup.sessionId === sessionId) return;
      throw new AllocationError("already-allocated");
    }

    const occupied = tx
      .select({ count: sql<number>`count(*)` })
      .from(allocations)
      .where(eq(allocations.sessionId, sessionId))
      .get();
    if ((occupied?.count ?? 0) >= session.capacity) throw new AllocationError("full");

    const student = tx.select({ username: users.username }).from(users).where(eq(users.id, studentId)).get();

    tx.insert(allocations)
      .values({
        sessionId,
        activityGroupId: session.activityGroupId,
        studentId,
        // The pre-auth column: kept NOT NULL for historical-shape reasons
        // only (see schema.ts) and never read by app code after this point.
        legacyUserId: student?.username ?? `user-${studentId}`,
      })
      .run();
  });
}

export function deallocateSession(studentId: number, sessionId: number): void {
  db.delete(allocations)
    .where(and(eq(allocations.sessionId, sessionId), eq(allocations.studentId, studentId)))
    .run();
}
