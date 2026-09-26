import type { APIRoute } from "astro";
import { SESSION_COOKIE_NAME, clearedSessionCookie, revokeSession } from "../../lib/auth";

// POST-only, and always redirects back to /login — this route is meant to be
// hit either by the nav's plain <form method="post"> (no JS required) or by
// fetch, and both want to land on the login page afterward. Revoking the
// server-side row (not just clearing the cookie) is what actually ends the
// session: a captured old cookie value is useless afterward, not just
// discarded client-side.
export const POST: APIRoute = ({ url, cookies }) => {
  const token = cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) revokeSession(token);

  return new Response(null, {
    status: 303,
    headers: {
      location: "/login",
      "set-cookie": clearedSessionCookie(url.protocol === "https:"),
    },
  });
};
