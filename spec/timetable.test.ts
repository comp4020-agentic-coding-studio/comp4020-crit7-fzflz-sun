import { beforeAll, describe, expect, inject, it } from "vitest";
import { login } from "./auth-helper";
import { cardMarkup, findCard, hasCard, parseCards } from "./card-helper";

// Covers the spec's core promise: picking a session on the timetable is a
// real, persisted allocation that changes what the *whole group* shows, not
// just the clicked card — and it's the database doing the filtering, not the
// client. Runs as "alice" (see src/lib/seed.ts), whose seeded enrolments and
// starting allocation give exactly the fixture shapes this suite needs:
//   - COMP1010 Tutorial: no pick yet — Mon 10:00 (TUT_A), Tue 14:00 (TUT_B,
//     this suite's scratch session), Wed 09:00 (TUT_C, seeded full 5/5).
//   - COMP2100 Lab: no pick yet — Mon 10:30 (LAB_A, overlaps TUT_A), Thu
//     13:00 (LAB_B).
//   - COMP3120 Workshop: alice already holds Fri 14:00 (WORKSHOP_B, inherited
//     from the original single-user demo pick), so Fri 11:00 (WORKSHOP_A)
//     stays hidden behind it.
const baseUrl = inject("baseUrl");

let cookie: string;

async function getHtml(): Promise<string> {
  return (await fetch(new URL("/", baseUrl), { headers: { cookie } })).text();
}

async function allocate(sessionId: number): Promise<Response> {
  return fetch(new URL("/api/allocations", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ sessionId }),
  });
}

async function deallocate(sessionId: number): Promise<Response> {
  return fetch(new URL("/api/allocations", baseUrl), {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ sessionId }),
  });
}

// Captured once up front, before any test allocates tutB — once that
// happens, tutA is hidden from every subsequent render (visibleForGroup
// collapses the group to just the pick), so a later test can't re-discover
// its id by re-parsing the page.
let tutAId: number;

describe("timetable allocation", () => {
  beforeAll(async () => {
    cookie = await login(baseUrl, "alice");

    // Every test starts from the same known state: no allocation in
    // COMP1010 Tutorial. Harmless when already true — deallocate is a plain
    // delete-if-present, and only ever removes alice's own row.
    const html = await getHtml();
    const cards = parseCards(html);
    tutAId = findCard(cards, "COMP1010", "Tutorial", "10:00").id;
    await deallocate(tutAId);
    await deallocate(findCard(cards, "COMP1010", "Tutorial", "14:00").id);
  });

  it("shows only the picked session for a group that already has one", async () => {
    const cards = parseCards(await getHtml());
    const workshopB = findCard(cards, "COMP3120", "Workshop", "14:00");
    expect(workshopB.status).toBe("allocated");
    expect(hasCard(cards, "COMP3120", "Workshop", "11:00")).toBe(false);
  });

  it("shows every candidate for a group with no pick yet", async () => {
    const cards = parseCards(await getHtml());
    for (const time of ["10:00", "14:00", "09:00"]) {
      expect(hasCard(cards, "COMP1010", "Tutorial", time), `Tutorial ${time} should be visible`).toBe(
        true,
      );
    }
    expect(findCard(cards, "COMP1010", "Tutorial", "09:00").status).toBe("full");
  });

  it("selecting a candidate hides only its own group's other candidates", async () => {
    const before = parseCards(await getHtml());
    const tutB = findCard(before, "COMP1010", "Tutorial", "14:00");
    const res = await allocate(tutB.id);
    expect(res.status).toBe(201);

    const cards = parseCards(await getHtml());
    expect(findCard(cards, "COMP1010", "Tutorial", "14:00").status).toBe("allocated");
    expect(hasCard(cards, "COMP1010", "Tutorial", "10:00")).toBe(false);
    expect(hasCard(cards, "COMP1010", "Tutorial", "09:00")).toBe(false);
    // Other activity groups are untouched.
    expect(hasCard(cards, "COMP2100", "Lab", "10:30")).toBe(true);
    expect(hasCard(cards, "COMP2100", "Lab", "13:00")).toBe(true);
    expect(hasCard(cards, "COMP3120", "Workshop", "14:00")).toBe(true);
    expect(hasCard(cards, "COMP3120", "Workshop", "11:00")).toBe(false);
  });

  it("persists that pick across a reload", async () => {
    const cards = parseCards(await getHtml());
    expect(findCard(cards, "COMP1010", "Tutorial", "14:00").status).toBe("allocated");
  });

  it("re-posting the same session is idempotent, not an error", async () => {
    const cards = parseCards(await getHtml());
    const tutB = findCard(cards, "COMP1010", "Tutorial", "14:00");
    const res = await allocate(tutB.id);
    expect(res.status).toBe(201);
  });

  it("refuses a different session in the same group with 409 already-allocated", async () => {
    // tutA's card is hidden right now (tutB is the group's current pick),
    // so its id has to come from the one captured before that happened —
    // this is exactly the direct-POST-to-a-hidden-session case the 409
    // guards against, not something reachable by clicking the rendered UI.
    const res = await allocate(tutAId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already-allocated" });
  });

  it("cancelling restores every candidate in the group, and persists that too", async () => {
    const before = parseCards(await getHtml());
    const tutB = findCard(before, "COMP1010", "Tutorial", "14:00");
    const res = await deallocate(tutB.id);
    expect(res.status).toBe(200);

    const cards = parseCards(await getHtml());
    for (const time of ["10:00", "14:00", "09:00"]) {
      expect(hasCard(cards, "COMP1010", "Tutorial", time), `Tutorial ${time} should be visible again`).toBe(
        true,
      );
    }
    expect(findCard(cards, "COMP1010", "Tutorial", "14:00").status).toBe("available");
  });

  it("refuses to allocate a full session", async () => {
    const cards = parseCards(await getHtml());
    const tutC = findCard(cards, "COMP1010", "Tutorial", "09:00");
    const res = await allocate(tutC.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "full" });
  });
});

describe("session card content", () => {
  beforeAll(async () => {
    cookie = await login(baseUrl, "alice");
  });

  it("renders course code and activity type as separate text, not merged onto one line", async () => {
    const html = await getHtml();
    const cards = parseCards(html);
    const workshopB = findCard(cards, "COMP3120", "Workshop", "14:00");
    const card = cardMarkup(html, workshopB.id);
    // Split so each can carry its own wrap/truncation rule (see styles.css) —
    // this pins down that the split actually happened, not just that the
    // text is present somewhere.
    expect(card).toContain('<span class="card-course">COMP3120</span>');
    expect(card).toContain('<span class="card-activity">Workshop</span>');
  });

  it("keeps the full course/activity/time/location detail in aria-label after the markup split", async () => {
    const html = await getHtml();
    const cards = parseCards(html);
    const workshopB = findCard(cards, "COMP3120", "Workshop", "14:00");
    const card = cardMarkup(html, workshopB.id);
    expect(card).toContain("COMP3120 Workshop, 14:00 to 15:00");
  });

  it("sizes cards with a strict height matching their real duration, not a min-height", async () => {
    const html = await getHtml();
    const cards = parseCards(html);
    const workshopB = findCard(cards, "COMP3120", "Workshop", "14:00");
    const card = cardMarkup(html, workshopB.id);
    const style = card.match(/style="([^"]*)"/)?.[1] ?? "";
    // A min-height would let wrapped text grow the card past its real time
    // slot — exactly the dense-overlap bug this fixed. Only a fixed height
    // guarantees the card's box always represents its actual duration.
    expect(style).toContain("height:");
    expect(style).not.toContain("min-height:");
  });

  it("associates the horizontal-scroll hint with the scrollable region via aria-describedby", async () => {
    const html = await getHtml();
    expect(html).toContain('id="scroll-hint"');
    expect(html).toContain('aria-describedby="scroll-hint"');
  });

  it("tells the user in plain text how to allocate and how to cancel", async () => {
    const html = await getHtml();
    expect(html).toContain("Select a dashed session to allocate it");
    expect(html).toContain("select your solid allocated session again to remove it");
  });

  it("spells out the available action in each card's aria-label, not just aria-pressed", async () => {
    const html = await getHtml();
    const cards = parseCards(html);
    const labB = findCard(cards, "COMP2100", "Lab", "13:00");
    const workshopB = findCard(cards, "COMP3120", "Workshop", "14:00");
    const available = cardMarkup(html, labB.id);
    const allocated = cardMarkup(html, workshopB.id);
    expect(available).toContain("select to allocate");
    expect(allocated).toContain("select again to cancel");
  });
});
