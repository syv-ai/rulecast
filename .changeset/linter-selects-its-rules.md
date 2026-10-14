---
"@syv-ai/rulecast": minor
---

A `linter` rule now turns on the rules it names instead of only reporting what the project's linter config already enables: ruff gets `--extend-select`, oxlint `-D` and eslint `--rule`. A rule asking for ruff `S110` used to find nothing in a project whose config didn't select it, which is most projects. Inline suppressions still hold, and so do ruff's `per-file-ignores` and oxlint's `overrides`. Rules without a `rules` list still see only what the project's config reports; they get a run of their own.
