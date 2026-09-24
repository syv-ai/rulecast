---
"@syv-ai/rulecast": minor
---

Three ways rulecast could stop responding, found by stress testing and fixed.

A rule that fired tens of thousands of times in one file — which an ordinary pattern does to a
generated or minified file — made the delivery take time proportional to the square of its matches:
62,000 matches took 5.9 seconds, and an 8 megabyte file never finished at all. Findings are now
grouped in place, and that file completes in a second.

A regex that backtracks exponentially could hold the edit hook, and the pre-write guard, open
indefinitely. The deadline could not stop it — the matching is synchronous, so the timer that would
fire the deadline never got to run — and the hook then reported the run as having finished on time.
Matching is now bounded by a timeout V8 can actually enforce, and a missed deadline is recorded as
one.

A session store with a half-written record in the middle of it threw out of the hook. It now runs
without session memory and says so, which is what the failure policy always specified.

Detectors now receive `deadlineAt` on `DetectorRun`: the wall-clock time after which their results
are discarded. A detector whose work is synchronous needs it, because `signal` cannot reach it.
