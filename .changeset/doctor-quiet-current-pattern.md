---
"@syv-ai/rulecast": patch
---

`rulecast doctor`: for a rule marked `expect: quiet` that matches no file, earlier runs count as "ran before" only on files its current `files` pattern takes. A hook rule that had no `files` ran on every changed file until one was added, so those runs made doctor call its new pattern stale, and `expect: quiet` could never apply to it. The weekly summary counts the same way, through the files the rule fired on.
