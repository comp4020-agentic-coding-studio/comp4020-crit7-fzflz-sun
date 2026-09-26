# Harness for this repo

This project replaces ANU's split timetable-view / allocation-table UX with
one directly-manipulable timetable. The rules below are the concrete,
already-decided constraints of that design — follow them exactly; don't
re-derive or "improve" them without being asked.

## Non-negotiable product rules

- The timetable grid (`src/pages/index.astro`) is the **only** allocation
  interface. There is no separate allocation table, list view, or modal —
  don't add one, even as a "convenience."
- Allocating a session hides only the **other candidates in that same
  activity group** (see `visibleForGroup` in `src/lib/db.ts`). Sessions in
  other activity groups are never affected by a pick or a cancellation.
- Switching from one session to another **within the same group** requires
  cancelling the current allocation first. A direct POST to allocate a
  different session in an already-allocated group must return
  `409 { error: "already-allocated" }` — do not make this silently swap the
  allocation instead.
- A session at capacity must be un-clickable (`disabled`) and a POST to it
  must return `409 { error: "full" }`.
- Overlapping sessions must render side-by-side at equal width within their
  day column (`layoutDay()` in `src/lib/layout.ts` computes `column` /
  `columnCount`; the page divides width by `columnCount`). Never let
  overlapping cards stack on top of each other.
- Status (Available / Allocated / Full) must be distinguishable by border
  style and fill pattern, not colour alone. Don't remove the dashed/solid/
  crosshatch styling in favour of colour-only cues.
- Every session card must visually show — not just expose via `title` or
  `aria-label` — its status, course code, activity type, start–end time,
  location, and remaining/capacity seats. If you change card content or the
  timetable's vertical scale, re-check that a normal 60-minute session still
  shows all six without clipping.

## Identity and authorisation rules

- Every page and API route derives the caller's identity from
  `context.locals.user` (set once per request by `src/middleware.ts` from
  the session cookie) — **never** from a `userId`/`studentId` in a request
  body or query string. A client cannot claim to be a different student by
  changing what it sends.
- `allocateSession`/`deallocateSession` (`src/lib/db.ts`) take the caller's
  id as an explicit parameter and scope every read/write to it. Don't add a
  code path that looks up or mutates an allocation by session id alone,
  without also constraining by the caller's own id.
- A student only ever sees candidate sessions for courses they're enrolled
  in (`enrolments` table, joined in `listTimetable`) — enforced by the SQL
  join itself, not filtered client-side afterwards. `allocateSession` must
  keep re-checking enrolment server-side too, since a direct POST can name
  any session id regardless of what the UI currently renders.
- Session capacity is shared across every student; per-user state
  (enrolment, which candidate is "mine") is not. Don't collapse these —
  a fix to one must never leak into the other.
- See `docs/DATABASE.md` for the full cookie → session → user resolution
  and the allocate transaction's race-safety argument before changing
  either.

## Database rules

- SQLite (via `better-sqlite3` + Drizzle) is the **sole** source of truth.
  Never fake or duplicate persistence with `localStorage`, cookies, or
  in-memory state — every allocation must be a real row read fresh on every
  request.
- Migrations are **append-only**. Never edit or delete an existing file
  under `drizzle/`. To change the schema: edit `src/lib/schema.ts`, run
  `pnpm db:generate`, and commit the new migration it writes alongside the
  existing ones.
- `client.pragma("foreign_keys = ON")` and `client.pragma("journal_mode =
  WAL")` must both stay set in `src/lib/db.ts`. Foreign keys are
  per-connection in SQLite — if you open a second connection anywhere
  (a script, a test), it needs the same pragma or it enforces nothing.
- Never edit the database file by hand and never manually touch the
  deployed Fly volume (`/data/app.db`) — state on it outlives every deploy.
- Seeding (`runSeed` in `src/lib/seed.ts`) is a sequence of named,
  `seed_state`-guarded steps, not an "if the table's empty" check. Adding
  new seed data means adding a **new** step with a **new** key — never
  change what an already-shipped step key does, or a database that already
  recorded that key as applied will silently skip the new behaviour. See
  `docs/DATABASE.md`'s "Seeding and upgrading" section.

## Deployment shape — do not change

- `fly.toml` / `Dockerfile` define a **single Fly machine** with a **1 GB
  volume mounted at `/data`**. This is the course-mandated shape for SQLite
  on Fly (no separate release machine, since there'd be nothing to share the
  volume with). Don't introduce a second machine, a separate DB service, or
  move persistence off the volume.

## Workflow

- Run `pnpm check` (typecheck + `pnpm test`, which builds then runs
  `vitest`) after every change, before considering it done.
- After any change touching layout, CSS, or the grid: visually check the
  page at both marking viewports — desktop `1920×1080` and mobile
  `390×844` — not just the automated checks. Confirm hour labels line up
  with the grid, cards aren't clipped, overlaps are still side-by-side, and
  there are no console errors.
- Keep `pnpm dev` running while iterating; the rendered page is the truth,
  not your mental model of the CSS.
- Never commit a red `pnpm check`.
- Never commit: `.env*`, `mise.local.toml`, any API token, the local
  `.data/` database, or `.data-backup-*/` directories. If you create a
  local DB backup for any reason, it must be gitignored, not deleted
  reflexively — it may be someone's in-progress recovery copy.
