// Shared by every spec file that needs a logged-in session: logs in as one
// of the seeded demo accounts (see src/lib/seed.ts) and returns the `Cookie`
// header value to send on subsequent requests. Never hardcodes a session id
// or token — every test that needs an authenticated identity goes through
// this same real login flow the browser would use.
export const DEMO_PASSWORD = "CritSeven!Demo";

export async function login(
  baseUrl: string,
  username: string,
  password: string = DEMO_PASSWORD,
): Promise<string> {
  const res = await fetch(new URL("/api/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
    redirect: "manual",
  });
  if (!res.ok) {
    throw new Error(`login as ${username} failed: ${res.status}`);
  }
  const setCookie = res.headers.getSetCookie();
  const cookie = setCookie[0]?.split(";")[0];
  if (!cookie) throw new Error(`login as ${username} did not set a cookie`);
  return cookie;
}
