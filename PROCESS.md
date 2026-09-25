# Process overview

## What I built

A single, directly-manipulable weekly timetable that replaces ANU's separate
timetable-view / allocation-table workflow. SQLite (via Drizzle) is the sole
source of truth for every allocation — the grid is a fresh read of the
database on every request, not client-side state.

## How I got here

I worked with an AI coding agent (Claude Code) across the whole build, but
kept it on a short leash: a project `CLAUDE.md` pinned down the rules that
weren't up for reinterpretation (one allocation per activity group, 409s
instead of silent overwrites, side-by-side overlap rendering, status
distinguishable without colour), `pnpm check` (typecheck + the full test
suite) had to pass after every change before I'd accept it, and I did my own
manual pass at both a desktop and a mobile viewport before treating a UI
change as done — an automated check can confirm a page renders without
throwing, it can't confirm an hour label lines up with the grid or that a
card's text is actually readable.

**Data model first.** Before any UI existed, I had the agent replace the
starter's guestbook demo with the schema this problem actually needs:
`courses`, `activity_groups`, `sessions` and `allocations`, plus seed data
for one representative week that deliberately includes a guaranteed overlap
and a full session, so every visual state would have something real to
render against from the start —
[`b9a6566`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-fzflz-sun/commit/b9a6566).

**Then the rules that make it safe to click things.** `listTimetable()`
joins sessions to their course and current allocation state and filters each
activity group down to just its picked session once one exists, so picking a
tutorial time hides its own group's other candidates without touching any
other course. `allocateSession()` enforces one pick per group and returns a
409 rather than silently swapping when you try to pick a second session in a
group you already hold one in, and a 409 rather than an allocation when a
session is already at capacity — both checked inside one database
transaction, not trusted to the client. I also had the agent turn on
SQLite's `foreign_keys` pragma explicitly (it's off by default in
better-sqlite3, and it's per-connection rather than a property of the file,
which is exactly the kind of thing that looks fine locally and silently
isn't enforced elsewhere) and write a test against the app's own connection
to prove the pragma had actually taken, not just that the code calling it
existed —
[`043de92`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-fzflz-sun/commit/043de92).

**Overlap layout.** Two sessions that clash in time needed to render
side-by-side rather than stack, including transitively — a session that
doesn't directly overlap either end of a cluster but sits between two that
do still has to share that cluster's column count. I checked this with unit
tests against the algorithm directly (partial overlap, a three-way clash,
back-to-back sessions that must *not* be treated as overlapping, a
transitive cluster) rather than trusting it by eye, plus a pipeline test
that proves the same-group hiding rule runs *before* layout, not after —
otherwise a session hidden by a pick made on a different day would still
have counted toward Monday's column width —
[`d3e30a5`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-fzflz-sun/commit/d3e30a5).

**The UI last, and it's where most of the actual correcting happened.**
The first pass of the timetable page had a real bug: the hour axis and the
day grid were drifting out of alignment, and overlapping cards were clipping
their own text, because "60 pixels per hour" was hardcoded in more than one
place and the two copies could disagree. Visual inspection at both marking
viewports is what caught it — the test suite was green the whole time,
because nothing in it asserted on pixel positions. The fix was to collapse
every vertical measurement on the page to one constant
(`PX_PER_MINUTE`, converted to CSS custom properties consumed by both the
axis and the grid) instead of patching the two copies to agree by
coincidence —
[`4d14e12`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-fzflz-sun/commit/4d14e12).

**Keeping the agent honest about its own commits.** When it came time to
commit this work, the agent's first proposal was to split the changes into
commits that matched the order I'd asked for them in a session, rather than
what each commit actually contained — which would have meant a commit
titled something like "fix: foreign key pragma" silently carrying the
entire rewritten database module along with it. I caught that before it was
pushed and had it re-split by what each diff actually was, so a reader
following the citations in this file sees what the commit message claims
and nothing else.

**Documentation.** README and CLAUDE.md were written last, once the app's
real behaviour existed to document — including this file's own commit list,
which cites the actual commits above rather than the placeholder text the
template shipped with —
[`bb714ca`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-fzflz-sun/commit/bb714ca).

## Before you ship

`pnpm check:evidence` verifies that this comment is gone, that your citations
resolve to real commits, that a crit week's reflection entry is in
`reflections/`, and that your `CLAUDE.md` is there. It checks that your account
is traceable, not that it is good: that is the marker's call.

Images aren't checked: unlike a citation whose SHA doesn't resolve, a broken
image is visible the moment this file is rendered on GitHub.
