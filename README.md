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

## Logging in, and what's really shared

This is now a real multi-user demo, not a single fixed identity. `/login`
has three pre-seeded demo accounts (`alice`, `ben`, `chen`, one shared demo
password shown right there on the page) with real server-side password
checking and persistent, expiring sessions — a cookie holds only a random
token, never a user id, and the server looks up who that token belongs to
on every request. Log in as one, pick a session, refresh, log out, log in
as another: you'll see *their* enrolled courses and *their* own picks, not
the previous student's. What genuinely carries across every logged-in
student is seat capacity — one course's remaining seats is a shared number,
so one student allocating into a near-full session is visible to every
other student looking at the same session. Full detail on how a cookie
resolves to a user, and how the capacity check stays race-safe when two
students click at once, is in [`docs/DATABASE.md`](docs/DATABASE.md).

Each student only ever sees candidate sessions for courses they're actually
enrolled in — enrolment is seed data this round, not a registration flow a
student can change themselves.

## How it's built

The backend is Astro (server-rendered pages and API routes, with a
middleware that resolves the session cookie once per request) and Drizzle
ORM over a SQLite database (via `better-sqlite3`). The database is the
single source of truth: every allocation is a row in the `allocations`
table, scoped to the student who made it; the page is rendered from a fresh
read of that table on every request, and there is no client-side state
standing in for it. Allocating or cancelling a session is a real HTTP
request to `/api/allocations`, authenticated by the session cookie — the
grid you see after a reload reflects exactly what's in the database for
*that* logged-in student, and this has been manually verified by logging in
as two different students in two separate browser sessions, allocating a
session as each, and confirming each sees only their own pick while the
other's remaining-seat count visibly drops.

## Scope of this prototype

This is deliberately small, built around exactly:

- **Three demo students, one representative teaching week.** The seed data
  models one week's worth of sessions across eight courses, enough to show
  every state (available, allocated, full, hidden-by-pick, 2-way and 3-way
  overlaps) at once — not a full semester's timetable, and not real ANU
  accounts or real ANU data.
- **Seed-time enrolment.** Who's enrolled in what is part of the seed data,
  not something a student can change through the UI this round.

This prototype explicitly does **not** implement:

- A connection to any real ANU system or API — all data is local seed data.
- Self-service registration, password reset, or account creation.
- A waitlist for full sessions.
- Full-semester functionality (recurring weeks, semester start/end dates,
  timezone handling, etc.).
- Image upload or AI image generation.

## What "good" means here

Good, for this prototype, means the two-screens problem is actually gone:
picking, seeing a clash, and cancelling a pick all happen on one grid, with
no separate table to cross-reference and no information hidden behind a
hover or a screen-reader-only label that isn't also visible on the card
itself. It means state genuinely persists in the database rather than being
faked in the browser, and that the rules a real allocation system needs —
one pick per activity group, no picking into a full session, hiding
candidates that are no longer real choices, one student never able to see
or touch another's picks, capacity actually shared across everyone
allocating into it — are enforced by the server on every request, not just
suggested by the UI.

It does not mean feature-complete: the explicit non-goals above (a real ANU
system connection, self-service registration, waitlists, a full semester)
are the acknowledged edges of what "good" covers in this pass.
