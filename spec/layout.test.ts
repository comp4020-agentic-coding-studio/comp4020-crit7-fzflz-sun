import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

beforeAll(async () => {
  const dbModule = await import("../src/lib/db");
  listTimetable = dbModule.listTimetable;
  allocateSession = dbModule.allocateSession;
});

describe("pipeline: hiding same-group candidates runs before layout, not after", () => {
  const MONDAY = 0;
  const TUT_A = 1; // Mon 10:00–11:00 (Tutorial group)
  const LAB_A = 4; // Mon 10:30–11:30 (Lab group) — overlaps TUT_A
  const TUT_B = 2; // Tue 14:00 — same Tutorial group as TUT_A

  it("lays out both Monday sessions side by side while the Tutorial group has no pick yet", () => {
    const monday = listTimetable().filter((s) => s.dayOfWeek === MONDAY);
    expect(monday.map((s) => s.id).sort()).toEqual([TUT_A, LAB_A].sort());

    const laidOut = layoutDay(monday);
    for (const s of laidOut) expect(s.columnCount).toBe(2);
  });

  it("drops the now-hidden Monday candidate from the layout once its group is picked elsewhere", () => {
    // Picking TUT_B hides every other Tutorial candidate, including
    // Monday's TUT_A — even though the pick itself is on Tuesday. If the
    // pipeline ever laid out Monday's raw session list before filtering,
    // this would still see two sessions and columnCount 2.
    allocateSession(TUT_B);

    const monday = listTimetable().filter((s) => s.dayOfWeek === MONDAY);
    expect(monday.map((s) => s.id)).toEqual([LAB_A]);

    const laidOut = layoutDay(monday);
    expect(laidOut).toHaveLength(1);
    expect(laidOut[0].column).toBe(0);
    expect(laidOut[0].columnCount).toBe(1);
  });
});
