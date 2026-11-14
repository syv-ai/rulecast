---
"@syv-ai/rulecast": minor
---

rulecast now supports [hk](https://hk.jdx.dev) as a git-hook manager, beside pre-commit and lefthook (#87).

- **`hook` rules can run an hk step:** `detect: { hook: { hk: pre-commit/eslint } }` names a hook and a step in `hk.pkl` (or `.config/hk.pkl`, the config hk reads after `hk.pkl`). A `commit-msg` step is refused: it checks the commit message, and a hook rule runs on files. rulecast runs `hk run <hook> --check --step <step> --stash none --no-stage --format json` on the rule's files. Only the step's check command runs, never its fix, and the working tree is left as it is. A `pre-push` step is run with `--from-ref HEAD --to-ref HEAD` and stand-ins for the remote and its url, so hk checks exactly the rule's files and never contacts the git remote. A step is not run at all while hk's Pkl package is not in its cache: the rule's error names `hk validate`, which downloads it once, so a hook never fetches it behind the developer's back; every hk call also runs with `HK_PKL_OFFLINE=1`, so hk itself refuses to download. The step's output is read like any other hook's.
- **`rulecast init` offers hk's steps when hk is installed.** `hk.pkl` is written in Pkl, which only hk can evaluate, so init asks hk for its plan (`hk run <hook> --plan --json --all --check`) of the `pre-commit` and `check` hooks, and offers each step once, with every hook it is in as its `stages`. Init uses no network for this: hk is asked only when every Pkl package its configs use is already in hk's cache (`$HK_PKL_CACHE_DIR` when set), and never for `pre-push`, whose plan asks the git remote. Otherwise `hooks.skipped` says so and names the hk command that lists the steps. It also lists a step hk never runs to check (only a fix command, or a profile that is not enabled), each `commit-msg` step, and hk's own error when it can't plan a hook. Without hk installed, the dry run says the steps couldn't be read. `detected.gitHooks` now lists hk.
- **`rulecast doctor` checks hk:** whether hk is installed, and every hook or step a rule names that hk doesn't know or never runs to check. Under the same rule as init, it warns instead of asking hk when that would use the network.
- **The git hooks guide has an hk section,** with the `rulecast` steps for `pre-commit` and `pre-push` in `hk.pkl`.

Tested against hk 2.12.0.
