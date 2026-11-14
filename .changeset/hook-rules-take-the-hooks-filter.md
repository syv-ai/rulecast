---
"@syv-ai/rulecast": minor
---

A pre-commit hook rule runs its hook only on the files the hook's own filter takes: its `types`, `types_or`, `exclude_types`, `files` and `exclude`, and the config's top-level `files` and `exclude`, as pre-commit applies them. Before, a rule with no filter of its own handed every changed file to the hook. A Python-only hook was then compared over Markdown files, and blamed for changes to them. `rulecast init` now writes the hook's filter into every hook rule, not only an always_run hook's, and `rulecast doctor` says (as information) when an existing rule could take it.
