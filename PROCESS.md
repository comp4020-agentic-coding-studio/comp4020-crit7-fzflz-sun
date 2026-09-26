# Process overview

ANU's own tools split "when is this session" from "which one is mine,"
forcing constant cross-referencing between two screens. The design decision
here was one directly-manipulable grid: SQLite is the only source of truth,
and picking a session hides only the other candidates in its own activity
group, never another course's. I had the agent express that as schema and
transactions rather than UI convention — `courses`/`activity_groups`/
`sessions`/`allocations` first
([`b9a6566`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-fzflz-sun/commit/b9a6566)),
then `allocateSession()` enforcing one pick per group and capacity inside a
single transaction, with the SQLite foreign-key pragma checked against the
app's own live connection rather than assumed
([`043de92`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-fzflz-sun/commit/043de92)),
then the overlap-into-columns layout verified with unit tests against
partial, three-way, and back-to-back cases, not trusted by eye
([`d3e30a5`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-fzflz-sun/commit/d3e30a5)).

That first pass ran one fixed demo identity, so the rule I cared about most
— a student's pick can never leak into another's — had nothing real to test
it against. This week's brief asked for that gap closed:

> 请将当前 ANU timetable 原型扩展为可以真实演示多用户登录、独立选课和共享课程容量的全栈应用。

I directed the agent to add real login (hashed passwords, expiring
server-side sessions) and scope every allocation read/write to the
session's own resolved user id, never a client-supplied one, with the
per-user "one pick per group" rule enforced as a database unique index, not
just an application check
([`aff4ee5...3e8a561`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-fzflz-sun/compare/aff4ee5...3e8a561)).
It passes `pnpm check` (typecheck, build, 73 vitest cases) locally,
including cross-user isolation and an upgrade path against a simulated
pre-login database.

Manual review still catches what tests don't: the grid's hour axis and
cards drifted out of pixel alignment while the suite stayed green, caught
only by looking at the rendered page at both marking viewports, not by
`pnpm check`
([`4d14e12`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-fzflz-sun/commit/4d14e12)).
