import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE_NAME, resolveSession } from "./lib/auth";

const PUBLIC_PATHS = new Set(["/login", "/readme/", "/api/login", "/api/logout"]);

// Resolves the session cookie into context.locals.user exactly once per
// request, then gates routes on it. Every page/API handler downstream trusts
// locals.user rather than re-checking cookies itself.
export const onRequest = defineMiddleware((context, next) => {
  const token = context.cookies.get(SESSION_COOKIE_NAME)?.value;
  const user = token ? resolveSession(token) : null;
  context.locals.user = user;

  const { pathname } = context.url;
  const isApi = pathname.startsWith("/api/");
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (!user && !isPublic) {
    if (isApi) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return context.redirect("/login");
  }

  if (user && pathname === "/login") {
    return context.redirect("/");
  }

  return next();
});
