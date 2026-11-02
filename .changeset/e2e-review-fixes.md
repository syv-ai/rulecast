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
