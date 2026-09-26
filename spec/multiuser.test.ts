import Database from "better-sqlite3";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { login } from "./auth-helper";
import { findCard, parseCards } from "./card-helper";

// Two genuinely distinct logged-in identities acting against the same shared
// server/database (see spec/global-setup.ts) — the scenarios timetable.test.ts
// can't cover because it only ever logs in as one student. Runs against
// COMP4620 Tutorial (Mon 14:00 / Thu 09:00, both cap 20, no seed picks or
// fillers — see src/lib/seed.ts) specifically because it's the one shared
// activity group no other spec file touches, so it's safe to mutate here
// without racing another test file's assertions about the same rows.
const baseUrl = inject("baseUrl");
const dbPath = inject("dbPath");

async function getHtml(cookie: string): Promise<string> {
  return (await fetch(new URL("/", baseUrl), { headers: { cookie } })).text();
}

async function allocate(cookie: string, sessionId: number): Promise<Response> {
  return fetch(new URL("/api/allocations", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ sessionId }),
  });
}

async function deallocate(cookie: string, sessionId: number): Promise<Response> {
  return fetch(new URL("/api/allocations", baseUrl), {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ sessionId }),
  });
}

// Card markup carries "R/C seats" as plain visible text (src/pages/index.astro)
// — reading it off the rendered page, rather than querying the database
// directly, is what proves the *page* reflects the shared count, not just the
// row.
function seatsRemaining(html: string, courseCode: string, activityType: string, startTime: string): number {
  const card = findCard(parseCards(html), courseCode, activityType, startTime);
  const marker = `data-session-id="${card.id}"`;
  const start = html.indexOf(marker);
  const cardEnd = html.indexOf("</button>", start);
  const block = html.slice(start, cardEnd);
  const match = block.match(/(\d+)\/(\d+) seats/);
  if (!match) throw new Error(`no seat count found for ${courseCode} ${activityType} ${startTime}`);
  return Number(match[1]);
}

describe("last-seat race: two concurrent allocate calls for one remaining seat", () => {
  let benCookie: string;
  let chenCookie: string;
  let tut4620AId: number;

  beforeAll(async () => {
    benCookie = await login(baseUrl, "ben");
    chenCookie = await login(baseUrl, "chen");
    tut4620AId = findCard(parseCards(await getHtml(benCookie)), "COMP4620", "Tutorial", "14:00").id;
  });

  it("lets exactly one of two simultaneous callers into the last seat", async () => {
    const db = new Database(dbPath);
    db.prepare("update sessions set capacity = 1 where id = ?").run(tut4620AId);
    db.close();

    const [ben, chen] = await Promise.all([
      allocate(benCookie, tut4620AId).then((res) => ({ who: "ben", cookie: benCookie, res })),
      allocate(chenCookie, tut4620AId).then((res) => ({ who: "chen", cookie: chenCookie, res })),
    ]);

    const winners = [ben, chen].filter((r) => r.res.status === 201);
    const losers = [ben, chen].filter((r) => r.res.status !== 201);
    expect(winners, "exactly one caller should win the last seat").toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].res.status).toBe(409);
    expect(await losers[0].res.json()).toEqual({ error: "full" });

    // Restore the group to its original untouched state so the isolation
    // tests below (and any future run) find it back at 20/20 with no pick.
    await deallocate(winners[0].cookie, tut4620AId);
    const restore = new Database(dbPath);
    restore.prepare("update sessions set capacity = 20 where id = ?").run(tut4620AId);
    restore.close();
  });
});

describe("cross-user isolation and shared capacity (ben & chen, COMP4620 Tutorial)", () => {
  let benCookie: string;
  let chenCookie: string;
  let tut4620AId: number; // Mon 14:00
  let tut4620BId: number; // Thu 09:00

  beforeAll(async () => {
    benCookie = await login(baseUrl, "ben");
    chenCookie = await login(baseUrl, "chen");
    const cards = parseCards(await getHtml(benCookie));
    tut4620AId = findCard(cards, "COMP4620", "Tutorial", "14:00").id;
    tut4620BId = findCard(cards, "COMP4620", "Tutorial", "09:00").id;
  });

  it("one student's pick reduces the seat count the other sees, without changing the other's own pick state", async () => {
    expect(seatsRemaining(await getHtml(chenCookie), "COMP4620", "Tutorial", "14:00")).toBe(20);

    const res = await allocate(benCookie, tut4620AId);
    expect(res.status).toBe(201);

    const benCards = parseCards(await getHtml(benCookie));
    expect(findCard(benCards, "COMP4620", "Tutorial", "14:00").status).toBe("allocated");
    // ben's own group collapses to just his pick...
    expect(benCards.some((c) => c.courseCode === "COMP4620" && c.activityType === "Tutorial" && c.time.startsWith("09:00"))).toBe(false);

    const chenHtml = await getHtml(chenCookie);
    const chenCards = parseCards(chenHtml);
    // ...but chen never picked, so she still sees both candidates as choices.
    expect(findCard(chenCards, "COMP4620", "Tutorial", "14:00").status).toBe("available");
    expect(findCard(chenCards, "COMP4620", "Tutorial", "09:00").status).toBe("available");
    // The seat ben took is visible in the shared count chen reads.
    expect(seatsRemaining(chenHtml, "COMP4620", "Tutorial", "14:00")).toBe(19);
    expect(seatsRemaining(chenHtml, "COMP4620", "Tutorial", "09:00")).toBe(20);
  });

  it("a DELETE naming another student's session id removes nothing", async () => {
    const res = await deallocate(chenCookie, tut4620AId);
    expect(res.status).toBe(200);

    const benCards = parseCards(await getHtml(benCookie));
    expect(findCard(benCards, "COMP4620", "Tutorial", "14:00").status).toBe("allocated");
  });

  it("rejects a direct POST for a session in a course the caller isn't enrolled in, even though the UI never renders it for them", async () => {
    // chen isn't enrolled in COMP2600; alice is, so her rendered page is the
    // (legitimate) source for a real COMP2600 session id. COMP2600 is also
    // the one course no other spec file ever reads or mutates for alice, so
    // this lookup can't race against timetable.test.ts's own alice-scoped
    // allocate/deallocate calls the way a COMP1010/COMP3120 lookup could.
    const aliceCookie = await login(baseUrl, "alice");
    const comp2600Session = findCard(parseCards(await getHtml(aliceCookie)), "COMP2600", "Tutorial", "11:00");

    const res = await allocate(chenCookie, comp2600Session.id);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not-enrolled" });
  });

  it("logging out and back in as the same student preserves her own pick, and still doesn't touch ben's", async () => {
    const allocateRes = await allocate(chenCookie, tut4620BId);
    expect(allocateRes.status).toBe(201);

    const logoutRes = await fetch(new URL("/api/logout", baseUrl), {
      method: "POST",
      headers: { cookie: chenCookie, origin: baseUrl },
      redirect: "manual",
    });
    expect(logoutRes.status).toBe(303);

    const relogged = await login(baseUrl, "chen");
    const chenCards = parseCards(await getHtml(relogged));
    expect(findCard(chenCards, "COMP4620", "Tutorial", "09:00").status).toBe("allocated");
    // Her own group view collapsed to her own pick (Thu), not ben's (Mon) —
    // hiding is per-caller, not a global "someone picked this group" flag.
    expect(chenCards.some((c) => c.courseCode === "COMP4620" && c.activityType === "Tutorial" && c.time.startsWith("14:00"))).toBe(false);

    const benCards = parseCards(await getHtml(benCookie));
    expect(findCard(benCards, "COMP4620", "Tutorial", "14:00").status).toBe("allocated");
  });
});
