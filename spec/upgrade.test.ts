import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Task 4's actual claim — that booting today's src/lib/db.ts against the
// *original* pre-login database is non-destructive, preserves existing rows,
// and never duplicates or resurrects anything on a later restart — is only
// really tested by booting the real module against a database shaped like
// that original volume, not by reasoning about seed.ts's source. So this
// builds a fixture with exactly the schema the original volume had (only
// migrations 0000+0001 applied — no users/auth_sessions/enrolments/
// seed_state/student_id, see drizzle/0002_complete_felicia_hardy.sql) and
// the natural-key rows seed.ts's own comments say it reproduces (COMP1010
// Tutorial Mon 10:00 with 5 legacy fillers, COMP3120 Workshop with the
// original "demo-student" pick on Fri 14:00) — then imports the real db.ts
// against it, twice, exactly like two real server boots on the same volume.

function buildLegacyMigrationsFolder(tmpDir: string): string {
  const dest = join(tmpDir, "drizzle-legacy");
  mkdirSync(join(dest, "meta"), { recursive: true });
  for (const file of ["0000_dry_captain_flint.sql", "0001_calm_maverick.sql"]) {
    cpSync(join("drizzle", file), join(dest, file));
  }
  for (const file of ["0000_snapshot.json", "0001_snapshot.json"]) {
    cpSync(join("drizzle", "meta", file), join(dest, "meta", file));
  }
  const journal = JSON.parse(readFileSync(join("drizzle", "meta", "_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 2);
  writeFileSync(join(dest, "meta", "_journal.json"), JSON.stringify(journal, null, 2));
  return dest;
}

function buildLegacyDatabase(path: string, migrationsFolder: string) {
  const client = new Database(path);
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");
  migrate(drizzle(client), { migrationsFolder });

  const course = (code: string, name: string, color: string): number =>
    Number(
      client.prepare("insert into courses (code, name, color) values (?,?,?)").run(code, name, color)
        .lastInsertRowid,
    );
  const group = (courseId: number, activityType: string): number =>
    Number(
      client
        .prepare("insert into activity_groups (course_id, activity_type) values (?,?)")
        .run(courseId, activityType).lastInsertRowid,
    );
  const session = (
    activityGroupId: number,
    dayOfWeek: number,
    startMinutes: number,
    endMinutes: number,
    location: string,
    capacity: number,
  ): number =>
    Number(
      client
        .prepare(
          "insert into sessions (activity_group_id, day_of_week, start_minutes, end_minutes, location, capacity) values (?,?,?,?,?,?)",
        )
        .run(activityGroupId, dayOfWeek, startMinutes, endMinutes, location, capacity).lastInsertRowid,
    );
  const allocate = (sessionId: number, activityGroupId: number, legacyUserId: string) =>
    client
      .prepare("insert into allocations (session_id, activity_group_id, user_id) values (?,?,?)")
      .run(sessionId, activityGroupId, legacyUserId);

  const comp1010 = course("COMP1010", "Introduction to Programming", "#2f6fed");
  const tutorial = group(comp1010, "Tutorial");
  const tutA = session(tutorial, 0, 600, 660, "Rm 1.01", 20); // Mon 10:00
  for (let i = 0; i < 5; i++) allocate(tutA, tutorial, `seed-student-${i}`);

  const comp3120 = course("COMP3120", "Web Systems", "#b1470f");
  const workshop = group(comp3120, "Workshop");
  const workshopA = session(workshop, 4, 660, 720, "Rm 3.01", 10); // Fri 11:00
  const workshopB = session(workshop, 4, 840, 900, "Rm 3.02", 10); // Fri 14:00
  for (let i = 0; i < 4; i++) allocate(workshopA, workshop, `seed-student-${40 + i}`);
  allocate(workshopB, workshop, "demo-student");

  client.close();
  return { tutorialGroupId: tutorial, workshopBId: workshopB };
}

describe("upgrading the original pre-login volume", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "upgrade-test-"));
  const dbPath = join(tmpDir, "app.db");
  let legacy: ReturnType<typeof buildLegacyDatabase>;

  beforeAll(() => {
    const migrationsFolder = buildLegacyMigrationsFolder(tmpDir);
    legacy = buildLegacyDatabase(dbPath, migrationsFolder);
    process.env.DATABASE_PATH = dbPath;
  });

  it("preserves pre-existing allocations, backfills student_id, and doesn't duplicate legacy fillers", async () => {
    const dbModule = await import("../src/lib/db");
    const client = dbModule.client;

    const alice = client.prepare("select id from users where username = 'alice'").get() as { id: number };
    expect(alice).toBeTruthy();

    // The original "demo-student" pick is still the same session, now with a
    // real student_id — inherited into alice specifically (see seed.ts).
    const workshopBAlloc = client
      .prepare("select student_id as studentId, session_id as sessionId from allocations where user_id = 'demo-student'")
      .get() as { studentId: number; sessionId: number };
    expect(workshopBAlloc.sessionId).toBe(legacy.workshopBId);
    expect(workshopBAlloc.studentId).toBe(alice.id);

    // A generic legacy id gets its own login-disabled placeholder, not alice.
    const placeholder = client
      .prepare(
        "select u.login_enabled as loginEnabled from allocations a join users u on u.id = a.student_id where a.user_id = 'seed-student-0'",
      )
      .get() as { loginEnabled: number };
    expect(placeholder.loginEnabled).toBe(0);
    const cannotLogin = client
      .prepare("select password_hash as h from users where id = (select student_id from allocations where user_id = 'seed-student-0')")
      .get() as { h: string };
    expect(cannotLogin.h).toBeTruthy(); // has some unusable random hash, not empty/null

    // Every original filler row on the legacy Tutorial group survived, with
    // no duplicates from the upgrade merging into the same natural-key group.
    const tutorialCount = client
      .prepare("select count(*) as n from allocations where activity_group_id = ?")
      .get(legacy.tutorialGroupId) as { n: number };
    expect(tutorialCount.n).toBe(5);

    // The new tables genuinely exist and are populated.
    const courseCount = client.prepare("select count(*) as n from courses").get() as { n: number };
    expect(courseCount.n).toBe(8);
    const enrolmentCount = client.prepare("select count(*) as n from enrolments").get() as { n: number };
    expect(enrolmentCount.n).toBeGreaterThan(0);
  });

  it("never resurrects a starting pick a student has since cancelled, and never duplicates on a second boot", async () => {
    const first = await import("../src/lib/db");
    const alice = first.client.prepare("select id from users where username = 'alice'").get() as { id: number };

    // alice cancels her seed-installed COMP1010 Lab Mon 10:15 pick (the
    // initial-allocations-v2 step's own write, not legacy data) — a real
    // student action, reproduced here with a direct delete since it's
    // equivalent to what deallocateSession does.
    const labPick = first.client
      .prepare(
        `select a.id as id from allocations a
         join sessions s on s.id = a.session_id
         join activity_groups g on g.id = a.activity_group_id
         join courses c on c.id = g.course_id
         where c.code = 'COMP1010' and g.activity_type = 'Lab' and s.day_of_week = 0 and s.start_minutes = 615
           and a.student_id = ?`,
      )
      .get(alice.id) as { id: number };
    expect(labPick).toBeTruthy();
    first.client.prepare("delete from allocations where id = ?").run(labPick.id);

    const beforeCounts = {
      courses: (first.client.prepare("select count(*) as n from courses").get() as { n: number }).n,
      allocations: (first.client.prepare("select count(*) as n from allocations").get() as { n: number }).n,
      users: (first.client.prepare("select count(*) as n from users").get() as { n: number }).n,
      seedState: (first.client.prepare("select count(*) as n from seed_state").get() as { n: number }).n,
    };
    first.client.close();

    // Simulate a second real server boot against the same database file: a
    // fresh module graph, so src/lib/db.ts's top-level migrate()+runSeed()
    // genuinely runs again, exactly like restarting the process would.
    vi.resetModules();
    const second = await import("../src/lib/db");

    const afterCounts = {
      courses: (second.client.prepare("select count(*) as n from courses").get() as { n: number }).n,
      allocations: (second.client.prepare("select count(*) as n from allocations").get() as { n: number }).n,
      users: (second.client.prepare("select count(*) as n from users").get() as { n: number }).n,
      seedState: (second.client.prepare("select count(*) as n from seed_state").get() as { n: number }).n,
    };
    expect(afterCounts).toEqual(beforeCounts);

    const stillCancelled = second.client
      .prepare(
        `select a.id as id from allocations a
         join sessions s on s.id = a.session_id
         join activity_groups g on g.id = a.activity_group_id
         join courses c on c.id = g.course_id
         where c.code = 'COMP1010' and g.activity_type = 'Lab' and s.day_of_week = 0 and s.start_minutes = 615
           and a.student_id = ?`,
      )
      .get(alice.id);
    expect(stillCancelled).toBeUndefined();

    second.client.close();
  });
});
