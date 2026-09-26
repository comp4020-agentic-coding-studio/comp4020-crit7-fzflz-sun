# Crit 7 reflection

**What was the breakthrough that moved the work forward?**

The real shift wasn't a line of code, it was deciding the timetable itself
had to become the interface, not a display next to a separate allocation
table. The rest followed: the database has to be the only source of truth
for what's selected, an activity group has to hide its other candidates
the moment one is picked, and overlaps have to render side by side or the
"one screen" claim is a lie. Expressing those rules as database constraints
and server-side checks, not UI convention, is what made the interaction
trustworthy rather than plausible-looking.

This week pushed the same idea into identity. One demo student never
tested the rule I cared about most — that a pick can't become another
student's — since there was only ever one identity to check it against.
The fix was the same move again: who an allocation belongs to can't be a
client-sent value, it's resolved server-side from a session token and
enforced as a foreign key and a unique index, so a mistaken or forged id
has nothing to attach to.

**What did this work change about who I want to be as a software developer?**

It sharpened how much I distrust "it runs" as a stopping point when an
agent wrote the code. The suite stayed green through a real layout bug —
an hour axis misaligned with the grid, cards clipping their own text —
because nothing automated checks pixel alignment or whether text fits;
that only surfaced when I looked at the rendered page at both a desktop
and a mobile width. The same happened at commit time: a proposed split
looked reasonable until I checked what each commit actually contained,
and it didn't match its message. I want to keep being the kind of
developer who treats an agent's output as a draft to verify against the
thing's real, rendered, persisted behaviour — not a finished answer
because the pipeline stayed quiet.
