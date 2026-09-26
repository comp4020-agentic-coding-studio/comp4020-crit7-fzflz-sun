// The routes the invariants run against. When you add a page, add its route
// here, or the invariants stop covering it. AUTH_ROUTES require a logged-in
// session (see spec/auth-helper.ts) — the invariants log in once and fetch
// these with that session's cookie instead of anonymously.
export const ROUTES = ["/login", "/readme/"];
export const AUTH_ROUTES = ["/"];
