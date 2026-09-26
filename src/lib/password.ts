import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt (via Node's own crypto — no extra native dependency, unlike argon2)
// is a mature, salted, memory-hard password hash. N=16384/r=8/p=1 costs about
// 128*N*r bytes ≈ 16 MiB per hash, comfortably inside Fly's 256 MB machine
// even with a few logins landing at once — see OWASP's Password Storage
// Cheat Sheet's scrypt guidance and docs/DATABASE.md for the reasoning.
//
// Lives in its own module (no import of db.ts) so src/lib/seed.ts can hash
// the demo accounts' passwords without creating a seed.ts -> auth.ts ->
// db.ts -> seed.ts import cycle.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length, { N, r, p });
  // Buffers must be equal length for timingSafeEqual — a mismatched stored
  // hash (corrupt data, wrong format) fails safely rather than throwing.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
