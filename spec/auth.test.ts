import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { DEMO_PASSWORD, login } from "./auth-helper";

const baseUrl = inject("baseUrl");
const dbPath = inject("dbPath");

function tokenFromCookie(cookie: string): string {
  return cookie.split("=")[1];
}

// Directly manipulates the same SQLite file the running server uses, to
// exercise states a real login flow can't produce on demand (an already-
// expired session). WAL mode allows this second, independent connection to
// read/write concurrently with the server's own.
function expireSession(rawToken: string): void {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const db = new Database(dbPath);
  db.prepare("update auth_sessions set expires_at = ? where token_hash = ?").run(
    new Date(Date.now() - 60_000).toISOString(),
    tokenHash,
  );
  db.close();
}

describe("login", () => {
  it("rejects an incorrect password", async () => {
    const res = await fetch(new URL("/api/login", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid-credentials" });
  });

  it("rejects a username that doesn't exist, with the same error as a wrong password", async () => {
    const res = await fetch(new URL("/api/login", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: DEMO_PASSWORD }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid-credentials" });
  });

  it("accepts the correct password and sets an HttpOnly session cookie", async () => {
    const res = await fetch(new URL("/api/login", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: DEMO_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie()[0];
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("cannot log in to a login-disabled placeholder account even with a guessed username", async () => {
    // filler-1 exists (see src/lib/seed.ts) but loginEnabled = 0.
    const res = await fetch(new URL("/api/login", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "filler-1", password: DEMO_PASSWORD }),
    });
    expect(res.status).toBe(401);
  });
});

describe("route protection", () => {
  it("redirects an unauthenticated page request to /login", async () => {
    const res = await fetch(new URL("/", baseUrl), { redirect: "manual" });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("returns 401 JSON for an unauthenticated API request", async () => {
    const res = await fetch(new URL("/api/allocations", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: 1 }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("treats a forged cookie value as unauthenticated, not a crash", async () => {
    const res = await fetch(new URL("/", baseUrl), {
      redirect: "manual",
      headers: { cookie: "session=not-a-real-token" },
    });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("treats an expired session as unauthenticated", async () => {
    const cookie = await login(baseUrl, "alice");
    expireSession(tokenFromCookie(cookie));

    const res = await fetch(new URL("/", baseUrl), { redirect: "manual", headers: { cookie } });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toBe("/login");
  });
});

describe("logout", () => {
  let cookie: string;

  beforeAll(async () => {
    cookie = await login(baseUrl, "ben");
  });

  it("works while logged in", async () => {
    const res = await fetch(new URL("/", baseUrl), { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it("revokes the session server-side, not just the cookie client-side", async () => {
    // Astro's built-in CSRF origin-check middleware treats a POST with no
    // content-type and no matching Origin header as cross-site and rejects
    // it with 403 — a real browser's same-origin form/fetch always sends a
    // matching Origin automatically, so this mirrors that instead of the
    // bare cross-origin shape a raw fetch() would otherwise send.
    const logoutRes = await fetch(new URL("/api/logout", baseUrl), {
      method: "POST",
      headers: { cookie, origin: baseUrl },
      redirect: "manual",
    });
    expect(logoutRes.status).toBe(303);
    expect(logoutRes.headers.get("location")).toBe("/login");

    // Re-presenting the very same (now-revoked) cookie must be rejected —
    // a page saved from before logout, or a copied cookie value, is useless.
    const res = await fetch(new URL("/", baseUrl), { redirect: "manual", headers: { cookie } });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toBe("/login");
  });
});
