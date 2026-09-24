---
"@syv-ai/rulecast": minor
---

Warnings can no longer crowd findings out of a delivery, and a very large file can no longer hold
up a write.

Eighty rules that fail to compile used to produce eighty warnings — 13,500 characters against a
9,000 character budget — and the one rule that still worked was dropped whole, so the agent was
told eighty times that rulecast was broken and nothing about its own code. A rule repo pinned to a
rev that has moved does exactly this, and that is the moment the working rules matter most.

Two changes. Compile diagnostics and detector errors now collapse above three of a kind into one
line with a count and an example — "80 rules failed to compile and were skipped — run rulecast
validate" — keyed so that a rule breaking later in the session is still announced. And warnings are
charged against the context budget *after* the findings rather than before them, capped at a share
of it, so no number of warnings of any kind can cost the agent a finding it could act on. The other
warnings are untouched: each already names a specific setting to change.

New config key **`max_file_bytes`** (default 1 MiB). `ast-grep` parses in native code, which the
timeout that bounds `regex` cannot interrupt, and the pre-write guard runs it before the agent's
write is allowed: a 5 MB proposed write measured 942 ms of a blocked agent. Files over the ceiling
are now skipped by the in-process detectors (`regex`, `path`, `ast-grep`) on edit and on guard, and
the same write returns in 1 ms. `verify`, which has seconds to spend, always runs. A skipped file is
written to the debug log, not delivered as a warning, and does not mark the run failed.
