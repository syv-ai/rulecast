---
"@syv-ai/rulecast": minor
---

rulecast no longer goes quiet in a fresh environment, such as a CI job, a cloud agent session or a new container, when it is configured but cannot run some of its rules. Common causes are a pinned rule repo that was never fetched (`rulecast install` was not run), a linter or script that is not installed, and a rule that fails to compile.

- **Agent hooks, unattended mode:** every stop names the rules that did not run and why, for example "2 rules disabled: …@v1.0.0: not in the cache (run rulecast install)". When nothing else blocks, the main agent is held once per prompt and told to state in its final report that those checks did not run. It is told not to repair rulecast's setup itself. A block for findings lists the rules that were not checked. Attended sessions are unchanged: the problem is said once.
- **`rulecast run`** says `incomplete: N rules did not run` instead of reading as clean, and `--format json` has a new `disabled` key: `[{ "reason", "rules" }]`. `run --session` also names rules the agent's session had disabled.
- **`rulecast doctor --ci`** checks what a headless run needs: pinned repos as the hooks will find them (hooks never fetch), detector dependencies, hooks that cannot run, the mode, and with `--from-ref REF` whether a merge base can be found. It exits 2 when rulecast would run degraded. It is on by itself when `CI` or `GITHUB_ACTIONS` is set.
- **The hook command changed.** When rulecast is not installed (no `node_modules`) and the run is unattended by its environment (`RULECAST_MODE=unattended`, `CI` or `GITHUB_ACTIONS`), every stop now says so. To get it, run `rulecast install` again and commit `.claude/settings.json`.

The README has a "Fresh environments" checklist under "Git hooks and CI".
