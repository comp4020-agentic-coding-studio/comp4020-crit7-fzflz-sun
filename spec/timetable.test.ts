import { beforeAll, describe, expect, inject, it } from "vitest";

// Covers the spec's core promise: picking a session on the timetable is a
// real, persisted allocation that changes what the *whole group* shows, not
// just the clicked card — and it's the database doing the filtering, not the
// client. Session ids below come from src/lib/seed.ts's fixed insertion
// order: 1/2/3 = comp1010 Tutorial (unassigned at seed time), 4/5 =
// comp2100 Lab (unassigned), 6/7 = comp3120 Workshop (7 already held by the
// demo student, so 6 stays hidden behind it).
const baseUrl = inject("baseUrl");

const TUT_A = 1; // Mon 10:00, available
const TUT_B = 2; // Tue 14:00, available — this suite's scratch session
const TUT_C = 3; // Wed 09:00, full (5/5)
const LAB_A = 4; // Mon 10:30, available — overlaps TUT_A
const LAB_B = 5; // Thu 13:00, available
const WORKSHOP_A = 6; // Fri 11:00, hidden behind the existing pick below
const WORKSHOP_B = 7; // Fri 14:00, already allocated to the demo student

async function getHtml(): Promise<string> {
  return (await fetch(new URL("/", baseUrl))).text();
}

function hasCard(html: string, sessionId: number): boolean {
  return html.includes(`data-session-id="${sessionId}"`);
}

function cardStatus(html: string, sessionId: number): string {
  const marker = `data-session-id="${sessionId}"`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`no card for session ${sessionId}`);
  const cardStart = html.lastIndexOf("<button", start);
  const cardEnd = html.indexOf(">", start);
  const opening = html.slice(cardStart, cardEnd);
  if (opening.includes("status-allocated")) return "allocated";
  if (opening.includes("status-full")) return "full";
  return "available";
}

async function allocate(sessionId: number): Promise<Response> {
  return fetch(new URL("/api/allocations", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

async function deallocate(sessionId: number): Promise<Response> {
  return fetch(new URL("/api/allocations", baseUrl), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

describe("timetable allocation", () => {
  // Every test starts from the same known state: no demo allocation in the
  // Tutorial group. Harmless when already true — deallocate is a plain
  // delete-if-present.
  beforeAll(async () => {
    await deallocate(TUT_A);
    await deallocate(TUT_B);
  });

  it("shows only the picked session for a group that already has one", async () => {
    const html = await getHtml();
    expect(hasCard(html, WORKSHOP_B)).toBe(true);
    expect(cardStatus(html, WORKSHOP_B)).toBe("allocated");
    expect(hasCard(html, WORKSHOP_A)).toBe(false);
  });

  it("shows every candidate for a group with no pick yet", async () => {
    const html = await getHtml();
    for (const id of [TUT_A, TUT_B, TUT_C, LAB_A, LAB_B]) {
      expect(hasCard(html, id), `session ${id} should be visible`).toBe(true);
    }
    expect(cardStatus(html, TUT_C)).toBe("full");
  });

  it("selecting a candidate hides only its own group's other candidates", async () => {
    const res = await allocate(TUT_B);
    expect(res.status).toBe(201);

    const html = await getHtml();
    expect(cardStatus(html, TUT_B)).toBe("allocated");
    expect(hasCard(html, TUT_A)).toBe(false);
    expect(hasCard(html, TUT_C)).toBe(false);
    // Other activity groups are untouched.
    expect(hasCard(html, LAB_A)).toBe(true);
    expect(hasCard(html, LAB_B)).toBe(true);
    expect(hasCard(html, WORKSHOP_B)).toBe(true);
    expect(hasCard(html, WORKSHOP_A)).toBe(false);
  });

  it("persists that pick across a reload", async () => {
    const html = await getHtml();
    expect(cardStatus(html, TUT_B)).toBe("allocated");
  });

  it("re-posting the same session is idempotent, not an error", async () => {
    const res = await allocate(TUT_B);
    expect(res.status).toBe(201);
  });

  it("refuses a different session in the same group with 409 already-allocated", async () => {
    const res = await allocate(TUT_A);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already-allocated" });
  });

  it("cancelling restores every candidate in the group, and persists that too", async () => {
    const res = await deallocate(TUT_B);
    expect(res.status).toBe(200);

    const html = await getHtml();
    for (const id of [TUT_A, TUT_B, TUT_C]) {
      expect(hasCard(html, id), `session ${id} should be visible again`).toBe(true);
    }
    expect(cardStatus(html, TUT_B)).toBe("available");
  });

  it("refuses to allocate a full session", async () => {
    const res = await allocate(TUT_C);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "full" });
  });
});
