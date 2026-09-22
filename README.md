# Your ANU timetable, as one page

## The problem

ANU's current enrolment tools split one decision — "which tutorial/lab/workshop
session am I in?" — across two separate screens: a timetable that shows *when*
things happen, and a separate allocation table where you actually *pick* a
session by cross-referencing IDs, times and remaining seats by hand. Neither
view tells you the whole story on its own, so choosing a session means
constantly flipping between the two and re-matching rows.

## What this prototype does instead

This is a single, directly-manipulable timetable. There is no second table.
Every session — tutorial, lab, workshop — renders as a card on the week grid,
positioned and sized by its real day and time. You allocate yourself into a
session by clicking its card, and cancel by clicking it again. That's the
entire interaction.

Each card shows, without needing a click or a hover: its status, course code
and activity type, start–end time, location, and remaining/capacity seats.
Overlapping sessions (e.g. a lab that clashes with a tutorial) render
side-by-side at equal width in their day column, so a clash is visible as
soon as the page loads, not discovered later.

### The three states

- **Available** — dashed border, tinted fill. Click to allocate.
- **Allocated** — solid fill in the course colour. This is the session you
  currently hold for that activity. Click to cancel.
- **Full** — a crosshatched pattern, disabled. Cannot be clicked.

All three are distinguishable by border style and fill pattern as well as
colour, so the state doesn't depend on colour perception alone.

### Selecting, hiding, and cancelling

Each session belongs to an activity group (e.g. "COMP1010 Tutorial" is one
group with several candidate times). The rule this prototype enforces:

- A group with **no allocation yet** shows every candidate session in it.
- The moment you allocate into one candidate, the **other candidates in that
  same group** disappear from the grid — they were never independently
  choosable once you'd already picked one, so leaving them visible would
  just recreate the two-screens problem this prototype exists to remove.
- Cancelling your allocation restores every candidate in that group.
- Switching to a different session in the same group requires cancelling
  the current one first — the interface only ever tracks one committed pick
  per group at a time, and a direct attempt to allocate a second session in
  an already-allocated group is refused rather than silently swapped.

Sessions in *other* activity groups are never affected by a pick or a
cancellation in this group.

## How it's built

The backend is Astro (server-rendered pages and API routes) with Drizzle ORM
over a SQLite database (via `better-sqlite3`). The database is the single
source of truth: every allocation is a row in the `allocations` table, the
page is rendered from a fresh read of that table on every request, and there
is no client-side state standing in for it. Allocating or cancelling a
session is a real HTTP request to `/api/allocations`; the grid you see after
a reload reflects exactly what's in the database, and this has been
manually verified by allocating a session, reloading the page, and
confirming the pick survives.

## Scope of this prototype

This is deliberately small, built around exactly:

- **One demo student.** There is no login and no real ANU identity —
  every allocation in this prototype belongs to the same fixed demo user.
- **One representative teaching week.** The seed data models one week's
  worth of sessions across a handful of courses, enough to show every state
  (available, allocated, full, hidden-by-pick, overlapping) at once — not a
  full semester's timetable.

This prototype explicitly does **not** implement:

- A connection to any real ANU system or API — all data is local seed data.
- Authentication, accounts, or more than one student.
- A waitlist for full sessions.
- Full-semester functionality (recurring weeks, semester start/end dates,
  timezone handling, etc.).

## What "good" means here

Good, for this prototype, means the two-screens problem is actually gone:
picking, seeing a clash, and cancelling a pick all happen on one grid, with
no separate table to cross-reference and no information hidden behind a
hover or a screen-reader-only label that isn't also visible on the card
itself. It means state genuinely persists in the database rather than being
faked in the browser, and that the rules a real allocation system needs —
one pick per activity group, no picking into a full session, hiding
candidates that are no longer real choices — are enforced by the server on
every request, not just suggested by the UI.

It does not mean feature-complete: the explicit non-goals above (real ANU
data, auth, waitlists, a full semester) are the acknowledged edges of what
"good" covers in this pass.
