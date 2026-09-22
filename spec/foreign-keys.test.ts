import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// src/lib/db.ts picks up DATABASE_PATH at import time and immediately
// migrates + seeds against it, so this has to be set — to a throwaway file,
// never the shared local .data/app.db — before that module is ever
// imported anywhere in this process.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "fk-test-")), "test.db");

let db: typeof import("../src/lib/db").db;
let client: typeof import("../src/lib/db").client;
let allocations: typeof import("../src/lib/schema").allocations;

beforeAll(async () => {
  const dbModule = await import("../src/lib/db");
  const schema = await import("../src/lib/schema");
  db = dbModule.db;
  client = dbModule.client;
  allocations = schema.allocations;
});

describe("SQLite foreign key enforcement", () => {
  it("is turned on for the app's own connection", () => {
    const [{ foreign_keys }] = client.pragma("foreign_keys") as [{ foreign_keys: number }];
    expect(foreign_keys).toBe(1);
  });

  it("rejects an allocation that references a session that doesn't exist", () => {
    expect(() =>
      db
        .insert(allocations)
        .values({ sessionId: 999_999, activityGroupId: 1, userId: "fk-test-orphan" })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("still migrated and seeded this fresh database successfully with foreign_keys already on", () => {
    const [{ n }] = client.prepare("select count(*) as n from courses").all() as [{ n: number }];
    expect(n).toBeGreaterThan(0);
  });
});
