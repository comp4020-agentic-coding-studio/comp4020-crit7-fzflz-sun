# Crit 7 reflection

**What was the breakthrough that moved the work forward?**

The real shift wasn't a line of code, it was deciding the timetable itself
had to become the interface, not a display next to a separate allocation
table. Once that was the target, the design mostly followed from it: if the
grid is the only way to choose a session, the database has to be the only
source of truth for what's selected, each activity group has to hide its
own other candidates the moment one is picked, and overlapping sessions
have to render side by side or the "one screen" claim is a lie. Expressing
those rules as database constraints and server-side checks, rather than UI
conventions, is what made the interaction trustworthy rather than just
plausible-looking.

**What did this work change about who I want to be as a software developer?**

It sharpened how much I distrust "it runs" as a stopping point when an
agent wrote the code. The test suite stayed green through a real layout
bug — an hour axis misaligned with the grid, overlapping cards clipping
their own text — because nothing automated asserts on pixel alignment or
whether a card's text actually fits. That only surfaced because I looked at
the rendered page at both a desktop and a mobile width instead of trusting
a passing `pnpm check`. The same thing happened at the commit stage: a
proposed commit split looked reasonable until I checked what each commit
would actually contain, and it didn't match its own message. I want to keep
being the kind of developer who treats an agent's output as a draft to
verify against the real, rendered, persisted behaviour of the thing — not a
finished answer because the pipeline stayed quiet.
