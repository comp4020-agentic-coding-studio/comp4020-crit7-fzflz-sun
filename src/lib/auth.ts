import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { authSessions, users } from "./schema";
import { db } from "./db";

const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export type AuthedUser = {
  id: number;
  username: string;
  displayName: string;
};

// The raw token is the only secret that ever reaches the browser (in the
// cookie). Only its SHA-256 hash is stored — a fast hash is correct here
// (unlike a password): the token already has 256 bits of entropy, so nothing
// is gained by making it slow to check, and a fast lookup is what a login
// session needs on every request. See OWASP's Session Management Cheat
// Sheet's "opaque session token" pattern, and docs/DATABASE.md.
export function createSession(userId: number): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  db.insert(authSessions)
    .values({ userId, tokenHash: sha256Hex(token), expiresAt: expiresAt.toISOString() })
    .run();
  return { token, expiresAt };
}

export function revokeSession(token: string): void {
  db.delete(authSessions).where(eq(authSessions.tokenHash, sha256Hex(token))).run();
}

// Resolves a raw cookie token to the still-valid, login-enabled user it
// belongs to — or null for anything else (no such token, expired, or a user
// since disabled). Expiry lives in this table, not in memory, so a session
// created before a server restart is still recognised after one.
export function resolveSession(token: string): AuthedUser | null {
  const row = db
    .select({
      userId: authSessions.userId,
      expiresAt: authSessions.expiresAt,
      username: users.username,
      displayName: users.displayName,
      loginEnabled: users.loginEnabled,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(eq(authSessions.tokenHash, sha256Hex(token)))
    .get();

  if (!row) return null;
  if (!row.loginEnabled) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return null;

  return { id: row.userId, username: row.username, displayName: row.displayName };
}

export function findLoginableUser(username: string) {
  return db
    .select()
    .from(users)
    .where(and(eq(users.username, username), eq(users.loginEnabled, 1)))
    .get();
}

export const SESSION_COOKIE_NAME = "session";

export function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearedSessionCookie(secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}
