---
"@syv-ai/rulecast": patch
---

`rulecast doctor`: for a rule marked `expect: quiet` that matches no file, earlier runs count as "ran before" only on files its current `files` pattern takes. A hook rule that had no `files` ran on every changed file until one was added, so those runs made doctor call its new pattern stale, and `expect: quiet` could never apply to it. The weekly summary keeps only the files a rule fired on: a week whose files the pattern doesn't take now doesn't count, and a week with none recorded still counts, since its files can't be known. A deleted file the rule's type tags would read from its content counts too. The summary can't say which files a run was on, so runs from before a pattern was narrowed count again once they have rotated into it.
