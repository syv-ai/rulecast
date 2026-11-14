---
"@syv-ai/rulecast": minor
---

The git hooks no longer block a commit or push when rulecast isn't installed (#84). A teammate who hasn't installed rulecast now sees this line, and the commit or push goes through:

```text
rulecast is not installed, so this hook checked nothing. To install it, run curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh
```

Before, the pre-commit and lefthook entries ended by running install.sh's rulecast, so with no rulecast anywhere they failed with "No such file or directory" and blocked every commit. The agent hooks already skipped in this case. A rulecast that can't start now counts as none too, including the project's own `node_modules/.bin/rulecast` when the `PATH` has no `node`, as in some GUI git clients. Before, that one blocked the commit with "node: not found".

The pre-commit entries are now `verbose: true`. pre-commit hides a passing hook's output, so without it the warning was never shown. Every git-hook entry (pre-commit, lefthook, hk) now runs `rulecast run --quiet`, so a clean commit or push prints nothing. Findings, warning-severity ones included, and an incomplete run print as before. `--quiet` works with the terminal and agent formats only; json, sarif, `fix` and `try-repo` reject it. The new entries need this release's rulecast, since an older one rejects `--quiet`. `rulecast doctor --ci` still fails when rulecast is missing, so CI is where a missing install shows up. A rulecast that runs and reports findings still fails the hook as before.

pre-commit picks up the new entry when you move `rev` to this release. The lefthook `run:` lines are copied into your `lefthook.yml`, so copy them again from `guides/git-hooks-ci.md`. The guide also has a new "A team" section on what happens for teammates without rulecast.
