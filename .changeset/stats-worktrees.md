---
"@syv-ai/rulecast": minor
---

`rulecast stats --worktrees GLOB` reads the project's log in every checkout of the repository whose directory name matches the glob (#71). `--worktrees '*'` reads them all and `--worktrees 'w2-*'` picks some. The flag is repeatable. Each worktree keeps its own log, so a setup with one worktree per agent used to mean running `stats` in each one and comparing by hand.

Worktrees removed since are included while their logs are still in rulecast's cache. The output names each checkout read, and marks those removed and those with nothing logged. Findings in different checkouts are kept apart even within one session: a lead session that spans ten worktrees doesn't merge a finding fixed in one with the same finding left open in another. `sessions` still counts each session once. `--format json` lists the checkouts under `checkouts`.
