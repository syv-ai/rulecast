---
"@syv-ai/rulecast": minor
---

rulecast now supports [hk](https://hk.jdx.dev) as a git-hook manager, beside pre-commit and lefthook (#87).

- **`hook` rules can run an hk step:** `detect: { hook: { hk: pre-commit/eslint } }` names a hook and a step in `hk.pkl`. rulecast runs `hk run <hook> --check --step <step> --stash none --no-stage --format json` on the rule's files. Only the step's check command runs, never its fix, and the working tree is left as it is. The step's output is read like any other hook's.
- **`rulecast init` offers hk's steps when hk is installed.** It asks hk for the steps of the `pre-commit`, `pre-push`, `check` and `commit-msg` hooks, and offers each step once. `hk.pkl` is written in Pkl, which only hk can evaluate, so without hk installed the dry run says the steps couldn't be read. `detected.gitHooks` now lists hk.
- **`rulecast doctor` checks hk:** whether hk is installed, and every hook or step a rule names that hk doesn't know.
- **The git hooks guide has an hk section,** with the `rulecast` steps for `pre-commit` and `pre-push` in `hk.pkl`.

Tested against hk 2.12.0.
