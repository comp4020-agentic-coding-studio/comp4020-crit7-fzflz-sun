import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { DEMO_USER_ID, activityGroups, allocations, courses, sessions } from "./schema";

// Demo data for the one representative teaching week this prototype models.
// Two activity groups (Tutorial, Lab) are left unpicked so their full set of
// candidates shows: a guaranteed Monday clash between them (10:30–11:00), and
// a full session (Wed Tutorial) that stays visible because its own group has
// no pick yet. The third group (Workshop) already holds the demo student's
// pick from a previous visit, so only that one session shows for it — its
// other candidate is deliberately NOT full, just hidden by the pick, so the
// "full" and "hidden by allocation" cases stay distinguishable from each
// other. Runs once, only against an empty database.
export function seedIfEmpty(db: BetterSQLite3Database): void {
  const existing = db.select().from(courses).limit(1).all();
  if (existing.length > 0) return;

  const [comp1010] = db
    .insert(courses)
    .values({ code: "COMP1010", name: "Introduction to Programming", color: "#2f6fed" })
    .returning()
    .all();
  const [comp2100] = db
    .insert(courses)
    .values({ code: "COMP2100", name: "Software Design Methodologies", color: "#1f9e6b" })
    .returning()
    .all();
  const [comp3120] = db
    .insert(courses)
    .values({ code: "COMP3120", name: "Web Systems", color: "#b1470f" })
    .returning()
    .all();

  const [tutorial1010] = db
    .insert(activityGroups)
    .values({ courseId: comp1010.id, activityType: "Tutorial" })
    .returning()
    .all();
  const [lab2100] = db
    .insert(activityGroups)
    .values({ courseId: comp2100.id, activityType: "Lab" })
    .returning()
    .all();
  const [workshop3120] = db
    .insert(activityGroups)
    .values({ courseId: comp3120.id, activityType: "Workshop" })
    .returning()
    .all();

  // Tutorial group (comp1010): no pick yet — all three candidates show.
  const [tutA, , tutC] = db
    .insert(sessions)
    .values([
      {
        activityGroupId: tutorial1010.id,
        dayOfWeek: 0,
        startMinutes: 600,
        endMinutes: 660,
        location: "Rm 1.01",
        capacity: 20,
      },
      {
        activityGroupId: tutorial1010.id,
        dayOfWeek: 1,
        startMinutes: 840,
        endMinutes: 900,
        location: "Rm 1.02",
        capacity: 20,
      },
      {
        activityGroupId: tutorial1010.id,
        dayOfWeek: 2,
        startMinutes: 540,
        endMinutes: 600,
        location: "Rm 1.03",
        capacity: 5,
      },
    ])
    .returning()
    .all();

  // Lab group (comp2100): no pick yet — labA overlaps tutA on Monday.
  const [labA, labB] = db
    .insert(sessions)
    .values([
      {
        activityGroupId: lab2100.id,
        dayOfWeek: 0,
        startMinutes: 630,
        endMinutes: 690,
        location: "Rm 2.01",
        capacity: 15,
      },
      {
        activityGroupId: lab2100.id,
        dayOfWeek: 3,
        startMinutes: 780,
        endMinutes: 840,
        location: "Rm 2.02",
        capacity: 15,
      },
    ])
    .returning()
    .all();

  // Workshop group (comp3120): demo student already holds workshopB, so
  // workshopA (not full — just outnumbered by the pick) stays hidden.
  const [workshopA, workshopB] = db
    .insert(sessions)
    .values([
      {
        activityGroupId: workshop3120.id,
        dayOfWeek: 4,
        startMinutes: 660,
        endMinutes: 720,
        location: "Rm 3.01",
        capacity: 10,
      },
      {
        activityGroupId: workshop3120.id,
        dayOfWeek: 4,
        startMinutes: 840,
        endMinutes: 900,
        location: "Rm 3.02",
        capacity: 10,
      },
    ])
    .returning()
    .all();

  const otherStudent = (n: number) => `seed-student-${n}`;

  db.insert(allocations)
    .values([
      // Tut A (Mon 10:00): 5 of 20 seats already taken by other students
      ...Array.from({ length: 5 }, (_, i) => ({
        sessionId: tutA.id,
        activityGroupId: tutorial1010.id,
        userId: otherStudent(i),
      })),
      // Tut B (Tue 14:00): empty, open for the demo student
      // Tut C (Wed 09:00): full — 5 of 5 seats taken by other students
      ...Array.from({ length: 5 }, (_, i) => ({
        sessionId: tutC.id,
        activityGroupId: tutorial1010.id,
        userId: otherStudent(10 + i),
      })),
      // Lab A (Mon 10:30 — overlaps Tut A): 3 of 15
      ...Array.from({ length: 3 }, (_, i) => ({
        sessionId: labA.id,
        activityGroupId: lab2100.id,
        userId: otherStudent(20 + i),
      })),
      // Lab B (Thu 13:00): 2 of 15
      ...Array.from({ length: 2 }, (_, i) => ({
        sessionId: labB.id,
        activityGroupId: lab2100.id,
        userId: otherStudent(30 + i),
      })),
      // Workshop A (Fri 11:00): 4 of 10 — not full, just hidden by the pick below
      ...Array.from({ length: 4 }, (_, i) => ({
        sessionId: workshopA.id,
        activityGroupId: workshop3120.id,
        userId: otherStudent(40 + i),
      })),
      // Workshop B (Fri 14:00): the demo student's existing pick from before
      { sessionId: workshopB.id, activityGroupId: workshop3120.id, userId: DEMO_USER_ID },
    ])
    .run();
}
