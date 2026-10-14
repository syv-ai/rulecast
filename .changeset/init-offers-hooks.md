---
"@syv-ai/rulecast": minor
---

`rulecast init` offers the project's own pre-commit and lefthook hooks as `hook` rules, shown in the review before anything is written. Hooks that look like formatters or fixers are offered but not ticked; hooks that run rulecast itself and pre-commit `meta` hooks are left out. Each rule cites the config that declares the hook until it is pointed at a convention. `--no-hooks` skips them.
