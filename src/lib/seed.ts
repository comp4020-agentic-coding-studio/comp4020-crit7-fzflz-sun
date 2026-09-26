import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "./password";
import {
  activityGroups,
  allocations,
  courses,
  enrolments,
  seedState,
  sessions,
  users,
} from "./schema";

// All demo accounts share this password so it can be printed on the login
// page for markers — see src/pages/login.astro. Never a placeholder for a
// real ANU password; the login page says so explicitly.
export const DEMO_PASSWORD = "CritSeven!Demo";

type DB = BetterSQLite3Database<Record<string, never>>;

function isApplied(db: DB, key: string): boolean {
  return db.select().from(seedState).where(eq(seedState.key, key)).get() !== undefined;
}

function markApplied(db: DB, key: string): void {
  db.insert(seedState).values({ key }).run();
}

// Finds a course by its (natural-key) code, inserting it only if missing —
// this is what makes the courses-v2 step safe to run against BOTH an empty
// database (nothing exists yet) and an upgrade of the original single-user
// database (comp1010/comp2100/comp3120 already exist with their original
// ids, sessions and allocations, which must be preserved untouched).
function ensureCourse(db: DB, code: string, name: string, color: string) {
  const existing = db.select().from(courses).where(eq(courses.code, code)).get();
  if (existing) return existing;
  return db.insert(courses).values({ code, name, color }).returning().get();
}

function ensureGroup(db: DB, courseId: number, activityType: string) {
  const existing = db
    .select()
    .from(activityGroups)
    .where(and(eq(activityGroups.courseId, courseId), eq(activityGroups.activityType, activityType)))
    .get();
  if (existing) return existing;
  return db.insert(activityGroups).values({ courseId, activityType }).returning().get();
}

type SessionSpec = {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
  location: string;
  capacity: number;
};

function ensureSession(db: DB, activityGroupId: number, spec: SessionSpec) {
  const existing = db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.activityGroupId, activityGroupId),
        eq(sessions.dayOfWeek, spec.dayOfWeek),
        eq(sessions.startMinutes, spec.startMinutes),
      ),
    )
    .get();
  if (existing) return existing;
  return db.insert(sessions).values({ activityGroupId, ...spec }).returning().get();
}

function ensureUser(
  db: DB,
  username: string,
  displayName: string,
  loginEnabled: boolean,
  password: string,
) {
  const existing = db.select().from(users).where(eq(users.username, username)).get();
  if (existing) return existing;
  return db
    .insert(users)
    .values({ username, displayName, loginEnabled: loginEnabled ? 1 : 0, passwordHash: hashPassword(password) })
    .returning()
    .get();
}

function fillerAllocation(db: DB, sessionId: number, activityGroupId: number, fillerUserId: number, fillerUsername: string) {
  db.insert(allocations)
    .values({ sessionId, activityGroupId, studentId: fillerUserId, legacyUserId: fillerUsername })
    .run();
}

// Reproduces a pre-auth-shaped allocation row exactly as the original
// single-user seed wrote it: only the text legacyUserId, studentId left
// NULL. The backfill-student-id-v2 step (below) is what later resolves
// these into real users — on a fresh database and on an upgraded
// pre-existing volume alike, so both converge on identical data.
function legacyAllocation(db: DB, sessionId: number, activityGroupId: number, legacyUserId: string) {
  db.insert(allocations).values({ sessionId, activityGroupId, legacyUserId }).run();
}

function groupExists(db: DB, courseId: number, activityType: string): boolean {
  return (
    db
      .select()
      .from(activityGroups)
      .where(and(eq(activityGroups.courseId, courseId), eq(activityGroups.activityType, activityType)))
      .get() !== undefined
  );
}

// ---------------------------------------------------------------------------
// Step: courses-v2 — the full course/activity-group/session catalog.
//
// COMP1010/COMP2100/COMP3120's original Tutorial/Lab/Workshop groups (7
// sessions, with their original legacy-shaped allocations) are reproduced
// here by natural key, so this step is safe to run once against EITHER a
// completely fresh database (nothing exists yet, so it creates everything)
// OR an upgrade of the original pre-existing single-user volume (those rows
// already exist, so ensureCourse/ensureGroup/ensureSession just find them
// and the `*IsNew` guards skip re-inserting their legacy fillers) — both
// converge on identical data. A second activity group is then added to each
// of those three courses, plus 5 brand-new courses.
// ---------------------------------------------------------------------------
function seedCoursesAndFillers(db: DB) {
  const fillers = Array.from({ length: 8 }, (_, i) =>
    ensureUser(db, `filler-${i + 1}`, "Enrolled student (seat only)", false, randomUnusedPassword()),
  );
  let fillerIndex = 0;
  function nextFiller() {
    const f = fillers[fillerIndex % fillers.length];
    fillerIndex += 1;
    return f;
  }
  function fillSeats(sessionId: number, activityGroupId: number, count: number) {
    for (let i = 0; i < count; i++) {
      const f = nextFiller();
      fillerAllocation(db, sessionId, activityGroupId, f.id, f.username);
    }
  }

  // --- COMP1010 (original Tutorial group — reproduces the pre-auth
  // single-user seed's exact catalog and legacy fillers, so a fresh boot and
  // an upgrade of a pre-existing volume converge on identical data; the
  // fillers are gated on the group not already existing so an upgrade never
  // re-inserts them) ---
  const comp1010 = ensureCourse(db, "COMP1010", "Introduction to Programming", "#2f6fed");
  const comp1010TutorialIsNew = !groupExists(db, comp1010.id, "Tutorial");
  const comp1010Tutorial = ensureGroup(db, comp1010.id, "Tutorial");
  const tutA = ensureSession(db, comp1010Tutorial.id, {
    dayOfWeek: 0,
    startMinutes: 600,
    endMinutes: 660,
    location: "Rm 1.01",
    capacity: 20,
  }); // Mon 10:00-11:00
  ensureSession(db, comp1010Tutorial.id, {
    dayOfWeek: 1,
    startMinutes: 840,
    endMinutes: 900,
    location: "Rm 1.02",
    capacity: 20,
  }); // Tue 14:00-15:00 — no fillers, deliberately left with open seats
  const tutC = ensureSession(db, comp1010Tutorial.id, {
    dayOfWeek: 2,
    startMinutes: 540,
    endMinutes: 600,
    location: "Rm 1.03",
    capacity: 5,
  }); // Wed 09:00-10:00 — full
  if (comp1010TutorialIsNew) {
    for (let i = 0; i < 5; i++) legacyAllocation(db, tutA.id, comp1010Tutorial.id, `seed-student-${i}`);
    for (let i = 0; i < 5; i++) legacyAllocation(db, tutC.id, comp1010Tutorial.id, `seed-student-${10 + i}`);
  }

  // --- COMP1010 (pre-existing course + Tutorial group) ---
  const comp1010Lab = ensureGroup(db, comp1010.id, "Lab");
  const lab1010A = ensureSession(db, comp1010Lab.id, {
    dayOfWeek: 0,
    startMinutes: 615,
    endMinutes: 675,
    location: "Rm 1.04",
    capacity: 15,
  }); // Mon 10:15-11:15 — 3-way overlap with COMP1010 Tutorial (Mon 10:00-11:00) and COMP2100 Lab (Mon 10:30-11:30)
  fillSeats(lab1010A.id, comp1010Lab.id, 2);
  const lab1010B = ensureSession(db, comp1010Lab.id, {
    dayOfWeek: 3,
    startMinutes: 900,
    endMinutes: 960,
    location: "Rm 1.05",
    capacity: 15,
  }); // Thu 15:00-16:00

  // --- COMP2100 (original Lab group — same reproduction as COMP1010 above) ---
  const comp2100 = ensureCourse(db, "COMP2100", "Software Design Methodologies", "#1f9e6b");
  const comp2100LabIsNew = !groupExists(db, comp2100.id, "Lab");
  const comp2100Lab = ensureGroup(db, comp2100.id, "Lab");
  const labA = ensureSession(db, comp2100Lab.id, {
    dayOfWeek: 0,
    startMinutes: 630,
    endMinutes: 690,
    location: "Rm 2.01",
    capacity: 15,
  }); // Mon 10:30-11:30 — overlaps COMP1010 Tutorial's Mon 10:00-11:00
  const labB = ensureSession(db, comp2100Lab.id, {
    dayOfWeek: 3,
    startMinutes: 780,
    endMinutes: 840,
    location: "Rm 2.02",
    capacity: 15,
  }); // Thu 13:00-14:00
  if (comp2100LabIsNew) {
    for (let i = 0; i < 3; i++) legacyAllocation(db, labA.id, comp2100Lab.id, `seed-student-${20 + i}`);
    for (let i = 0; i < 2; i++) legacyAllocation(db, labB.id, comp2100Lab.id, `seed-student-${30 + i}`);
  }

  // --- COMP2100 (pre-existing course + Lab group) ---
  const comp2100Tut = ensureGroup(db, comp2100.id, "Tutorial");
  const tut2100A = ensureSession(db, comp2100Tut.id, {
    dayOfWeek: 1,
    startMinutes: 540,
    endMinutes: 600,
    location: "Rm 2.03",
    capacity: 20,
  }); // Tue 09:00-10:00
  const tut2100B = ensureSession(db, comp2100Tut.id, {
    dayOfWeek: 3,
    startMinutes: 540,
    endMinutes: 600,
    location: "Rm 2.04",
    capacity: 20,
  }); // Thu 09:00-10:00

  // --- COMP3120 (original Workshop group — same reproduction as above,
  // including the original demo student's pre-existing pick on workshopB;
  // backfill-student-id-v2 later maps that "demo-student" row to alice) ---
  const comp3120 = ensureCourse(db, "COMP3120", "Web Systems", "#b1470f");
  const comp3120WorkshopIsNew = !groupExists(db, comp3120.id, "Workshop");
  const comp3120Workshop = ensureGroup(db, comp3120.id, "Workshop");
  const workshopA = ensureSession(db, comp3120Workshop.id, {
    dayOfWeek: 4,
    startMinutes: 660,
    endMinutes: 720,
    location: "Rm 3.01",
    capacity: 10,
  }); // Fri 11:00-12:00 — not full, just hidden by the pick on workshopB
  const workshopB = ensureSession(db, comp3120Workshop.id, {
    dayOfWeek: 4,
    startMinutes: 840,
    endMinutes: 900,
    location: "Rm 3.02",
    capacity: 10,
  }); // Fri 14:00-15:00
  if (comp3120WorkshopIsNew) {
    for (let i = 0; i < 4; i++) legacyAllocation(db, workshopA.id, comp3120Workshop.id, `seed-student-${40 + i}`);
    legacyAllocation(db, workshopB.id, comp3120Workshop.id, "demo-student");
  }

  // --- COMP3120 (pre-existing course + Workshop group) ---
  const comp3120Tut = ensureGroup(db, comp3120.id, "Tutorial");
  const tut3120A = ensureSession(db, comp3120Tut.id, {
    dayOfWeek: 4,
    startMinutes: 660,
    endMinutes: 720,
    location: "Rm 3.03",
    capacity: 20,
  }); // Fri 11:00-12:00 — runs concurrently with this course's own Workshop group (also Fri 11:00-12:00)
  const tut3120B = ensureSession(db, comp3120Tut.id, {
    dayOfWeek: 0,
    startMinutes: 780,
    endMinutes: 840,
    location: "Rm 3.04",
    capacity: 20,
  }); // Mon 13:00-14:00 — ends exactly when COMP4620 Tutorial (Mon 14:00) begins: adjacent, not overlapping

  // --- COMP2600 (new course) ---
  const comp2600 = ensureCourse(db, "COMP2600", "Formal Methods in Software Engineering", "#7a3fa0");
  const comp2600Tut = ensureGroup(db, comp2600.id, "Tutorial");
  const tut2600A = ensureSession(db, comp2600Tut.id, {
    dayOfWeek: 2,
    startMinutes: 660,
    endMinutes: 720,
    location: "Rm 4.01",
    capacity: 20,
  }); // Wed 11:00-12:00 — overlaps COMP1100 Tutorial (Wed 11:00-12:00)
  fillSeats(tut2600A.id, comp2600Tut.id, 2);
  const tut2600B = ensureSession(db, comp2600Tut.id, {
    dayOfWeek: 3,
    startMinutes: 660,
    endMinutes: 720,
    location: "Rm 4.02",
    capacity: 20,
  }); // Thu 11:00-12:00
  const comp2600Lab = ensureGroup(db, comp2600.id, "Lab");
  const lab2600A = ensureSession(db, comp2600Lab.id, {
    dayOfWeek: 1,
    startMinutes: 780,
    endMinutes: 870,
    location: "Rm 4.03",
    capacity: 15,
  }); // Tue 13:00-14:30 (90 min)
  fillSeats(lab2600A.id, comp2600Lab.id, 1);
  const lab2600B = ensureSession(db, comp2600Lab.id, {
    dayOfWeek: 4,
    startMinutes: 600,
    endMinutes: 660,
    location: "Rm 4.04",
    capacity: 4,
  }); // Fri 10:00-11:00 — deliberately exactly 1 seat remaining (3/4 filled, left open)
  fillSeats(lab2600B.id, comp2600Lab.id, 3);

  // --- COMP3620 (new course) ---
  const comp3620 = ensureCourse(db, "COMP3620", "Artificial Intelligence", "#c0389c");
  const comp3620Workshop = ensureGroup(db, comp3620.id, "Workshop");
  const workshop3620A = ensureSession(db, comp3620Workshop.id, {
    dayOfWeek: 2,
    startMinutes: 600,
    endMinutes: 660,
    location: "Rm 5.01",
    capacity: 12,
  }); // Wed 10:00-11:00
  fillSeats(workshop3620A.id, comp3620Workshop.id, 2);
  const workshop3620B = ensureSession(db, comp3620Workshop.id, {
    dayOfWeek: 2,
    startMinutes: 840,
    endMinutes: 960,
    location: "Rm 5.02",
    capacity: 12,
  }); // Wed 14:00-16:00 (120 min)
  const workshop3620C = ensureSession(db, comp3620Workshop.id, {
    dayOfWeek: 0,
    startMinutes: 900,
    endMinutes: 960,
    location: "Rm 5.03",
    capacity: 12,
  }); // Mon 15:00-16:00

  // --- COMP4300 (new course) ---
  const comp4300 = ensureCourse(db, "COMP4300", "Advanced Databases", "#d18f00");
  const comp4300Lab = ensureGroup(db, comp4300.id, "Lab");
  const lab4300A = ensureSession(db, comp4300Lab.id, {
    dayOfWeek: 0,
    startMinutes: 780,
    endMinutes: 870,
    location: "Rm 6.01",
    capacity: 15,
  }); // Mon 13:00-14:30 (90 min)
  fillSeats(lab4300A.id, comp4300Lab.id, 1);
  const lab4300B = ensureSession(db, comp4300Lab.id, {
    dayOfWeek: 3,
    startMinutes: 840,
    endMinutes: 900,
    location: "Rm 6.02",
    capacity: 15,
  }); // Thu 14:00-15:00

  // --- COMP4620 (new course) ---
  const comp4620 = ensureCourse(db, "COMP4620", "Machine Learning", "#2f8f8f");
  const comp4620Workshop = ensureGroup(db, comp4620.id, "Workshop");
  const workshop4620A = ensureSession(db, comp4620Workshop.id, {
    dayOfWeek: 2,
    startMinutes: 900,
    endMinutes: 990,
    location: "Rm 7.01",
    capacity: 10,
  }); // Wed 15:00-16:30 (90 min)
  fillSeats(workshop4620A.id, comp4620Workshop.id, 1);
  const workshop4620B = ensureSession(db, comp4620Workshop.id, {
    dayOfWeek: 4,
    startMinutes: 780,
    endMinutes: 840,
    location: "Rm 7.02",
    capacity: 10,
  }); // Fri 13:00-14:00
  fillSeats(workshop4620B.id, comp4620Workshop.id, 2);
  const comp4620Tut = ensureGroup(db, comp4620.id, "Tutorial");
  const tut4620A = ensureSession(db, comp4620Tut.id, {
    dayOfWeek: 0,
    startMinutes: 840,
    endMinutes: 900,
    location: "Rm 7.03",
    capacity: 20,
  }); // Mon 14:00-15:00 — begins exactly when COMP3120 Tutorial (Mon ends 14:00) finishes
  const tut4620B = ensureSession(db, comp4620Tut.id, {
    dayOfWeek: 3,
    startMinutes: 540,
    endMinutes: 600,
    location: "Rm 7.04",
    capacity: 20,
  }); // Thu 09:00-10:00

  // --- COMP1100 (new course) ---
  const comp1100 = ensureCourse(db, "COMP1100", "Introduction to Programming Concepts", "#8f8f2f");
  const comp1100Tut = ensureGroup(db, comp1100.id, "Tutorial");
  const tut1100A = ensureSession(db, comp1100Tut.id, {
    dayOfWeek: 2,
    startMinutes: 660,
    endMinutes: 720,
    location: "Rm 8.01",
    capacity: 20,
  }); // Wed 11:00-12:00 — overlaps COMP2600 Tutorial (Wed 11:00-12:00)
  fillSeats(tut1100A.id, comp1100Tut.id, 3);
  const tut1100B = ensureSession(db, comp1100Tut.id, {
    dayOfWeek: 4,
    startMinutes: 900,
    endMinutes: 960,
    location: "Rm 8.02",
    capacity: 20,
  }); // Fri 15:00-16:00
  const comp1100Lab = ensureGroup(db, comp1100.id, "Lab");
  const lab1100A = ensureSession(db, comp1100Lab.id, {
    dayOfWeek: 1,
    startMinutes: 840,
    endMinutes: 960,
    location: "Rm 8.03",
    capacity: 15,
  }); // Tue 14:00-16:00 (120 min)
  fillSeats(lab1100A.id, comp1100Lab.id, 2);
  const lab1100B = ensureSession(db, comp1100Lab.id, {
    dayOfWeek: 3,
    startMinutes: 900,
    endMinutes: 960,
    location: "Rm 8.04",
    capacity: 15,
  }); // Thu 15:00-16:00

  return {
    comp1010,
    comp2100,
    comp3120,
    comp2600,
    comp3620,
    comp4300,
    comp4620,
    comp1100,
    groups: { comp1010Lab, comp2100Tut, comp3120Tut, comp2600Tut, comp2600Lab, comp4300Lab, comp4620Workshop, comp4620Tut, comp1100Tut, comp1100Lab },
    sessions: { lab1010A, lab1010B, tut2100A, tut2100B, tut3120A, tut3120B, tut2600A, tut2600B, lab2600A, lab2600B, workshop3620A, workshop3620B, workshop3620C, lab4300A, lab4300B, workshop4620A, workshop4620B, tut4620A, tut4620B, tut1100A, tut1100B, lab1100A, lab1100B },
  };
}

let unusedPasswordCounter = 0;
function randomUnusedPassword(): string {
  // Seat-filler accounts have loginEnabled = 0, so this hash is never
  // actually checked — a real random value (not a constant) all the same,
  // so a bug that ignored loginEnabled wouldn't hand out a guessable login.
  unusedPasswordCounter += 1;
  return `${crypto.randomUUID()}-${unusedPasswordCounter}`;
}

export function runSeed(db: DB): void {
  if (!isApplied(db, "courses-v2")) {
    db.transaction((tx) => {
      seedCoursesAndFillers(tx as unknown as DB);
      markApplied(tx as unknown as DB, "courses-v2");
    });
  }

  let alice: typeof users.$inferSelect;
  let ben: typeof users.$inferSelect;
  let chen: typeof users.$inferSelect;

  if (!isApplied(db, "users-v2")) {
    db.transaction((tx) => {
      alice = ensureUser(tx as unknown as DB, "alice", "Alice Nguyen", true, DEMO_PASSWORD);
      ben = ensureUser(tx as unknown as DB, "ben", "Ben Carter", true, DEMO_PASSWORD);
      chen = ensureUser(tx as unknown as DB, "chen", "Chen Wei", true, DEMO_PASSWORD);
      markApplied(tx as unknown as DB, "users-v2");
    });
  } else {
    alice = db.select().from(users).where(eq(users.username, "alice")).get()!;
    ben = db.select().from(users).where(eq(users.username, "ben")).get()!;
    chen = db.select().from(users).where(eq(users.username, "chen")).get()!;
  }

  if (!isApplied(db, "enrolments-v2")) {
    db.transaction((tx) => {
      const c = (code: string) => tx.select().from(courses).where(eq(courses.code, code)).get()!;
      const enrol = (userId: number, courseId: number) =>
        tx.insert(enrolments).values({ userId, courseId }).run();

      for (const code of ["COMP1010", "COMP2100", "COMP3120", "COMP2600"]) enrol(alice.id, c(code).id);
      for (const code of ["COMP1010", "COMP3120", "COMP3620", "COMP4620"]) enrol(ben.id, c(code).id);
      for (const code of ["COMP2100", "COMP4300", "COMP4620", "COMP1100"]) enrol(chen.id, c(code).id);

      markApplied(tx as unknown as DB, "enrolments-v2");
    });
  }

  // Legacy pre-auth allocation rows (from the original single-user seed)
  // have `studentId IS NULL` and a text `legacyUserId` like "demo-student" or
  // "seed-student-7". Map each distinct legacy id to a real user exactly
  // once: "demo-student" inherits into alice (a real, login-enabled demo
  // account); every other legacy id gets its own login-disabled placeholder
  // account, auto-created here, so old rows resolve to a real user without
  // granting any of them a working login. Runs generically off whatever
  // distinct legacy ids are actually present — nothing here is hardcoded to
  // a specific historical count.
  if (!isApplied(db, "backfill-student-id-v2")) {
    db.transaction((tx) => {
      const legacyRows = tx
        .selectDistinct({ legacyUserId: allocations.legacyUserId })
        .from(allocations)
        .where(isNull(allocations.studentId))
        .all();

      for (const { legacyUserId } of legacyRows) {
        const targetUserId =
          legacyUserId === "demo-student"
            ? alice.id
            : ensureUser(tx as unknown as DB, legacyUserId, "Legacy seat (pre-login data)", false, randomUnusedPassword()).id;

        tx.update(allocations)
          .set({ studentId: targetUserId })
          .where(and(eq(allocations.legacyUserId, legacyUserId), isNull(allocations.studentId)))
          .run();
      }

      markApplied(tx as unknown as DB, "backfill-student-id-v2");
    });
  }

  // Each demo student's starting picks — written only the first time this
  // step ever runs. Guarded purely by the seed_state marker (not by
  // re-checking the allocations table), so once a student cancels one of
  // these, a later restart can never bring it back.
  //
  // These are pure lookups against the catalog the courses-v2 step already
  // committed (in this boot or an earlier one) — deliberately not a second
  // call to seedCoursesAndFillers, which would re-run its filler INSERTs.
  if (!isApplied(db, "initial-allocations-v2")) {
    db.transaction((tx) => {
      const t = tx as unknown as DB;
      const group = (courseCode: string, activityType: string) =>
        t
          .select({ id: activityGroups.id })
          .from(activityGroups)
          .innerJoin(courses, eq(activityGroups.courseId, courses.id))
          .where(and(eq(courses.code, courseCode), eq(activityGroups.activityType, activityType)))
          .get()!;
      const session = (activityGroupId: number, dayOfWeek: number, startMinutes: number) =>
        t
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.activityGroupId, activityGroupId),
              eq(sessions.dayOfWeek, dayOfWeek),
              eq(sessions.startMinutes, startMinutes),
            ),
          )
          .get()!;
      const give = (studentId: number, username: string, sessionId: number, activityGroupId: number) =>
        t.insert(allocations).values({ sessionId, activityGroupId, studentId, legacyUserId: username }).run();

      const comp1010Lab = group("COMP1010", "Lab");
      give(alice.id, alice.username, session(comp1010Lab.id, 0, 615).id, comp1010Lab.id); // Mon 10:15 — 3-way overlap

      const comp3120Tut = group("COMP3120", "Tutorial");
      give(ben.id, ben.username, session(comp3120Tut.id, 4, 660).id, comp3120Tut.id); // Fri 11:00 — concurrent with Workshop

      const comp4620Workshop = group("COMP4620", "Workshop");
      give(ben.id, ben.username, session(comp4620Workshop.id, 4, 780).id, comp4620Workshop.id); // Fri 13:00

      const comp4300Lab = group("COMP4300", "Lab");
      give(chen.id, chen.username, session(comp4300Lab.id, 0, 780).id, comp4300Lab.id); // Mon 13:00

      const comp2100Lab = group("COMP2100", "Lab");
      give(chen.id, chen.username, session(comp2100Lab.id, 0, 630).id, comp2100Lab.id); // Mon 10:30 — part of the 3-way overlap, chen's own view of it

      markApplied(t, "initial-allocations-v2");
    });
  }
}
