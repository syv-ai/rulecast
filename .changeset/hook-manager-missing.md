---
"@syv-ai/rulecast": patch
---

A `hook` rule whose hook manager isn't set up in the repository now says so (#87). This happens when a project moves from pre-commit to another hook manager and keeps its `hook/*` rules, or when a rule is copied from another repository. `rulecast validate` and `rulecast doctor` now say "no .pre-commit-config.yaml in the repository, so pre-commit is not set up here and this rule cannot run". Before, they said `no hook with id "mypy"`, as if only one hook were missing. `validate` now checks lefthook rules too: a lefthook rule with no lefthook config was caught only by `doctor`.
