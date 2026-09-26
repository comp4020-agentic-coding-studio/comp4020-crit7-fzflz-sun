import type { APIRoute } from "astro";
import { AllocationError, allocateSession, deallocateSession } from "../../lib/db";

async function readSessionId(request: Request): Promise<number | null> {
  const body = await request.json().catch(() => null);
  const sessionId = Number((body as { sessionId?: unknown } | null)?.sessionId);
  return Number.isInteger(sessionId) ? sessionId : null;
}

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const STATUS_FOR: Record<string, number> = {
  "not-found": 404,
  "not-enrolled": 403,
  "already-allocated": 409,
  full: 409,
};

// Allocate the current user into a session. The database is the source of
// truth for capacity, enrolment, and the "one session per activity group"
// rule (see src/lib/db.ts), so this route is just: check auth, validate
// input, translate the result. "already-allocated" and "full" are both 409s
// but distinct error codes, since the client tells the two apart (cancel
// first, vs pick another time). studentId always comes from the server-side
// session (locals.user), never from the request body — a caller cannot pick
// which user they allocate as.
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: "unauthenticated" }, 401);

  const sessionId = await readSessionId(request);
  if (sessionId === null) return json({ error: "invalid-session" }, 400);

  try {
    allocateSession(locals.user.id, sessionId);
    return json({ ok: true }, 201);
  } catch (err) {
    if (err instanceof AllocationError) {
      return json({ error: err.message }, STATUS_FOR[err.message] ?? 409);
    }
    throw err;
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: "unauthenticated" }, 401);

  const sessionId = await readSessionId(request);
  if (sessionId === null) return json({ error: "invalid-session" }, 400);

  deallocateSession(locals.user.id, sessionId);
  return json({ ok: true }, 200);
};
