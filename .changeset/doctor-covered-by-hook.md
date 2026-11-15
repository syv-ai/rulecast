---
"@syv-ai/rulecast": minor
---

`rulecast doctor` says when a ruff rule's codes already run in the project's pre-commit: `already covered by ruff-check in .pre-commit-config.yaml`, or `covered for 1 of 2 files` when the code is on for only some of the rule's files. It is info and never says to drop the rule: the overlap is harmless, and a rule can be kept to teach the fix at the edit. Whether a code is on for a file is ruff's own answer for that file under the hook's args, `per-file-ignores` and their negated patterns included. doctor says nothing when it can't be sure. eslint, gitleaks and lefthook jobs are not judged yet.
