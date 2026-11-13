---
"@syv-ai/rulecast": minor
---

The git hooks no longer block a commit or push when rulecast isn't installed (#84). A teammate who hasn't installed rulecast now sees this line, and the commit or push goes through:

```text
rulecast is not installed, so this hook checked nothing. To install it, run curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh
```

Before, the pre-commit and lefthook entries ended by running install.sh's rulecast, so with no rulecast anywhere they failed with "No such file or directory" and blocked every commit. The agent hooks already skipped in this case. `rulecast doctor --ci` still fails when rulecast is missing, so CI is where a missing install shows up. A rulecast that runs and reports findings still fails the hook as before.

pre-commit picks up the new entry when you move `rev` to this release. The lefthook `run:` lines are copied into your `lefthook.yml`, so copy them again from `guides/git-hooks-ci.md`. The guide also has a new "A team" section on what happens for teammates without rulecast.
