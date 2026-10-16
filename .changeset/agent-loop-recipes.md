---
"@syv-ai/rulecast": patch
---

New docs page: rulecast in agent loops (`agents/reference/loops.md`, on the site under Guides as "Agent loops"). It has recipes for running rulecast inside agent loops that nobody watches:

- a checklist before any loop: unattended mode, `rulecast doctor --ci`, and the `loop-safety` pack;
- a Claude Code `/goal` whose condition is `rulecast run --from-ref main` exiting 0, worded so that exits 2 and 3 end the run with a report instead of looping;
- a scheduled convention-drift sweep: one rule's new findings per run, `rulecast fix` for the ones it can fix, an agent for the rest, `rulecast baseline --prune`, and a draft pull request;
- babysitting a pull request with `/loop` and `rulecast run --from-ref`;
- reading `rulecast stats` to find noisy and dead rules, with the rules themselves revised together with the developer in a reviewed pull request.

The output contract (`agents/reference/output.md`) now lists the `disabled` key of `rulecast run --format json`: the rules that did not run, and why.
