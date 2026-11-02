---
"@syv-ai/rulecast": patch
---

Fixes from an end-to-end review of setup.

- The Claude Code hooks are always the guarded command. It runs the project's `node_modules/.bin/rulecast`, else a `rulecast` on the PATH, and otherwise says once per session that rulecast is not installed. Before, `init` or `install` run without rulecast in `node_modules` (as the plugin's setup does through npx) wrote a bare `rulecast hook claude-code`, which failed on every tool call where rulecast was not on the PATH. `install` upgrades those hooks in place.
- `doctor` no longer counts the temporary rulecast that `npx` or `pnpm dlx` runs it with as one the hooks will find.
- `init` offers hook ids that are valid rule ids: a lefthook job named `lint typescript` is `hook/pre-commit-lint-typescript`, and a local pre-commit hook `run_tests` is `hook/run-tests`. When validation fails, init no longer says to commit.
- SETUP.md adds rulecast as a devDependency (or a global install, without a `package.json`) before `init`.
- `install` raises the Stop and SubagentStop hooks' timeout when `timeouts.verify_ms` grows, and `doctor` reports hooks with a timeout too short as out of date. Before, a raised `verify_ms` left Claude Code killing the stop check at 70 s.
- SETUP.md no longer says hook rules run after every edit: they run when the agent stops.
- `add` and `list --catalog` find the catalog however its GitHub URL is cased (`Syv-AI/rulecast`), rather than add a second entry that fails validation. `list --catalog` labels catalog rules with the catalog, not `local`.
- The README's pre-commit `rev` and Status follow the version (`pnpm sync-version`). They said 0.4.
- SETUP.md and CONVENTIONS.md publish the page as an artifact only where the agent has a tool for it.
- A damaged line in a session store is skipped. Before, one such line dropped the session's memory, and with it the stop check, for every later hook of that session.
- The session lock is kept fresh while its holder works and released only by its holder, so a holder slower than the 5 s stale limit no longer lets other hook processes in alongside it.
