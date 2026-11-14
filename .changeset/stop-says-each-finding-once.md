---
"@syv-ai/rulecast": minor
---

An attended stop gives the agent each finding once. A finding an earlier stop already sent to the agent, found again in a file unchanged since, no longer holds the stop. A block names such findings in one line, with no rule text, and a stop that has only those is let through, with that line shown to the user. A finding that is fixed and later comes back, or that is still there after its file changed, counts as new and blocks again. Unattended mode is unchanged: a finding still blocks twice, then goes into the report.

Before, every block listed every finding in every file changed in the session, warnings included, under "fix them before you finish". So a finding the agent could not or should not fix (a protected config the user changed on purpose, say) cost an extra turn at every prompt.

**Breaking:** an attended stop whose findings were all sent at an earlier stop now returns `allow` with `repeated` set, where it used to block or return `capReached`.

The line naming repeats takes at most 15% of the context budget: past that it counts them instead of naming them. When several configs answer one hook, each config's own `max_matches_per_rule` now holds in the combined message. Before, the nearest config's setting cut every config's findings.
