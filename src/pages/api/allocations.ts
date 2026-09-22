import type { APIRoute } from "astro";
import { AllocationError, allocateSession, deallocateSession } from "../../lib/db";

async function readSessionId(request: Request): Promise<number | null> {
  const body = await request.json().catch(() => null);
  const sessionId = Number((body as { sessionId?: unknown } | null)?.sessionId);
  return Number.isInteger(sessionId) ? sessionId : null;
}

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Allocate the demo student into a session. The database is the source of
// truth for capacity and the "one session per activity group" rule (see
// src/lib/db.ts), so this route is just: validate input, translate the
// result. "already-allocated" and "full" are both 409s but distinct error
// codes, since the client tells the two apart (cancel first, vs pick another
// time).
export const POST: APIRoute = async ({ request }) => {
  const sessionId = await readSessionId(request);
  if (sessionId === null) return json({ error: "invalid-session" }, 400);

  try {
    allocateSession(sessionId);
    return json({ ok: true }, 201);
  } catch (err) {
    if (err instanceof AllocationError) {
      const status = err.message === "not-found" ? 404 : 409;
      return json({ error: err.message }, status);
    }
    throw err;
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const sessionId = await readSessionId(request);
  if (sessionId === null) return json({ error: "invalid-session" }, 400);

  deallocateSession(sessionId);
  return json({ ok: true }, 200);
};
