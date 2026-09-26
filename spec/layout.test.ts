import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { layoutDay } from "../src/lib/layout";

// Unit-level coverage for the pure column-assignment algorithm: asserts on
// `column`/`columnCount` directly, no DOM or pixels involved. Session
// contracts only need startMinutes/endMinutes, so plain fixtures with an id
// are enough — no course/status fields required.
function fixture(id: string, startMinutes: number, endMinutes: number) {
  return { id, startMinutes, endMinutes };
}

describe("layoutDay: column assignment", () => {
  it("gives two partially-overlapping sessions different columns", () => {
    const a = fixture("a", 60, 120);
    const b = fixture("b", 90, 150); // overlaps a from 90–120
    const [laidA, laidB] = layoutDay([a, b]);

    expect(laidA.column).toBe(0);
    expect(laidB.column).toBe(1);
    expect(laidA.columnCount).toBe(2);
    expect(laidB.columnCount).toBe(2);
  });

  it("gives three simultaneously-overlapping sessions columnCount 3", () => {
    const sessions = [fixture("a", 60, 120), fixture("b", 60, 120), fixture("c", 60, 120)];
    const laidOut = layoutDay(sessions);

    expect(laidOut.map((s) => s.column).sort()).toEqual([0, 1, 2]);
    for (const s of laidOut) expect(s.columnCount).toBe(3);
  });

  it("does not treat back-to-back sessions (one ends exactly when the next starts) as overlapping", () => {
    const a = fixture("a", 60, 120);
    const b = fixture("b", 120, 180); // starts exactly when a ends
    const laidOut = layoutDay([a, b]);

    // Neither one shares the timetable with anything else, so each is its
    // own column of one — not squeezed side-by-side into two half-width
    // columns the way genuinely overlapping sessions would be.
    for (const s of laidOut) {
      expect(s.column).toBe(0);
      expect(s.columnCount).toBe(1);
    }
  });

  it("treats a transitively-connected overlap cluster as one group, even where two members don't directly overlap", () => {
    // a overlaps b (90–120), b overlaps c (140–150), but a (60–120) and c
    // (140–200) never overlap each other directly.
    const a = fixture("a", 60, 120);
    const b = fixture("b", 90, 150);
    const c = fixture("c", 140, 200);
    const [laidA, laidB, laidC] = layoutDay([a, b, c]);

    expect(laidA.column).toBe(0);
    expect(laidB.column).toBe(1);
    // c starts after a has already ended, so it reuses a's freed column —
    // but it's still part of the same connected cluster as a and b, and
    // must be laid out against the cluster's shared column count.
    expect(laidC.column).toBe(0);
    for (const s of [laidA, laidB, laidC]) expect(s.columnCount).toBe(2);
  });
});

// This needs its own throwaway database and the real listTimetable() +
// allocateSession() from src/lib/db.ts, so DATABASE_PATH must point at a
// fresh temp file before that module is ever imported in this process (see
// spec/foreign-keys.test.ts for the same pattern; vitest isolates each test
// file's module graph, so this doesn't collide with that file's own temp db).
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "layout-pipeline-test-")), "test.db");

let listTimetable: typeof import("../src/lib/db").listTimetable;
let allocateSession: typeof import("../src/lib/db").allocateSession;
let db: typeof import("../src/lib/db").db;
let schema: typeof import("../src/lib/schema");

beforeAll(async () => {
  const dbModule = await import("../src/lib/db");
  listTimetable = dbModule.listTimetable;
  allocateSession = dbModule.allocateSession;
  db = dbModule.db;
  schema = await import("../src/lib/schema");
});

// Looked up by natural key (username / course code + activity type + start
// time) rather than hardcoded ids — ids shift whenever the seed catalog
// changes, but "alice" and "COMP1010 Tutorial Mon 10:00" are stable.
function userId(username: string): number {
  return db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, username)).get()!
    .id;
}

function sessionId(courseCode: string, activityType: string, dayOfWeek: number, startMinutes: number): number {
  return db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .innerJoin(schema.activityGroups, eq(schema.sessions.activityGroupId, schema.activityGroups.id))
    .innerJoin(schema.courses, eq(schema.activityGroups.courseId, schema.courses.id))
    .where(
      and(
        eq(schema.courses.code, courseCode),
        eq(schema.activityGroups.activityType, activityType),
        eq(schema.sessions.dayOfWeek, dayOfWeek),
        eq(schema.sessions.startMinutes, startMinutes),
      ),
    )
    .get()!.id;
}

describe("pipeline: hiding same-group candidates runs before layout, not after", () => {
  const MONDAY = 0;
  let alice: number;
  let tutA: number; // COMP1010 Tutorial, Mon 10:00–11:00
  let labA: number; // COMP2100 Lab, Mon 10:30–11:30 — overlaps tutA
  let tutB: number; // COMP1010 Tutorial, Tue 14:00 — same group as tutA

  beforeAll(() => {
    alice = userId("alice");
    tutA = sessionId("COMP1010", "Tutorial", MONDAY, 600);
    labA = sessionId("COMP2100", "Lab", MONDAY, 630);
    tutB = sessionId("COMP1010", "Tutorial", 1, 840);
  });

  // The richer seed catalog gives alice other Monday sessions too (her own
  // COMP1010 Lab pick, COMP3120 Tutorial's Monday candidate) — isolate this
  // pipeline check to just the two-group cluster it's actually about, by
  // course/activity rather than by day alone.
  function tutorialAndLabOnMonday(cards: ReturnType<typeof listTimetable>) {
    return cards.filter(
      (s) =>
        s.dayOfWeek === MONDAY &&
        ((s.courseCode === "COMP1010" && s.activityType === "Tutorial") ||
          (s.courseCode === "COMP2100" && s.activityType === "Lab")),
    );
  }

  it("lays out both Monday sessions side by side while the Tutorial group has no pick yet", () => {
    const monday = tutorialAndLabOnMonday(listTimetable(alice));
    expect(monday.map((s) => s.id).sort()).toEqual([tutA, labA].sort());

    const laidOut = layoutDay(monday);
    for (const s of laidOut) expect(s.columnCount).toBe(2);
  });

  it("drops the now-hidden Monday candidate from the layout once its group is picked elsewhere", () => {
    // Picking tutB hides every other Tutorial candidate, including
    // Monday's tutA — even though the pick itself is on Tuesday. If the
    // pipeline ever laid out Monday's raw session list before filtering,
    // this would still see two sessions and columnCount 2.
    allocateSession(alice, tutB);

    const monday = tutorialAndLabOnMonday(listTimetable(alice));
    expect(monday.map((s) => s.id)).toEqual([labA]);

    const laidOut = layoutDay(monday);
    expect(laidOut).toHaveLength(1);
    expect(laidOut[0].column).toBe(0);
    expect(laidOut[0].columnCount).toBe(1);
  });
});
