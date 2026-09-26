import type { APIRoute } from "astro";
import { createSession, findLoginableUser, sessionCookie } from "../../lib/auth";
import { verifyPassword } from "../../lib/password";

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Deliberately the same response, in the same shape, whether the username
// doesn't exist or the password is wrong — an attacker probing usernames
// gets no signal either way.
const INVALID = { error: "invalid-credentials" };

export const POST: APIRoute = async ({ request, url }) => {
  const body = await request.json().catch(() => null);
  const username = (body as { username?: unknown } | null)?.username;
  const password = (body as { password?: unknown } | null)?.password;
  if (typeof username !== "string" || typeof password !== "string") {
    return json(INVALID, 401);
  }

  const user = findLoginableUser(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return json(INVALID, 401);
  }

  const { token, expiresAt } = createSession(user.id);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": sessionCookie(token, expiresAt, url.protocol === "https:"),
    },
  });
};
