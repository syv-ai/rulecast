---
"@syv-ai/rulecast": minor
---

`rulecast stats --worktrees` says which checkouts a recurring file's findings came from: each `recurringFiles` entry has `checkouts`, and the terminal lists them beside the file when more than one checkout was read, as in `app/x.py (3 sessions; in main, w1)`.
