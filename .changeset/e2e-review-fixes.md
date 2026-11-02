---
"@syv-ai/rulecast": patch
---

Fixes from an end-to-end review of setup.

- The Claude Code hooks are always the guarded command. It runs the project's `node_modules/.bin/rulecast`, else a `rulecast` on the PATH (one that cannot execute, such as a version-manager shim with nothing behind it, counts as none), and otherwise says once per session that rulecast is not installed. Before, `init` or `install` run without rulecast in `node_modules` (as the plugin's setup does through npx) wrote a bare `rulecast hook claude-code`, which failed on every tool call where rulecast was not on the PATH. `install` upgrades those hooks in place.
- `doctor` no longer counts a rulecast that a package runner (`npx`, `pnpm dlx`, `yarn dlx`, `bunx`, `npm run`, `pnpm exec`) put on its PATH as one the hooks will find.
- `init` offers hook ids that are valid rule ids: a lefthook job named `lint typescript` is `hook/pre-commit-lint-typescript`, and a local pre-commit hook `run_tests` is `hook/run-tests`. When validation fails, init no longer says to commit.
- SETUP.md adds rulecast as a devDependency (or a global install, without a `package.json`) before `init`.
- `install` raises the Stop and SubagentStop hooks' timeout when `timeouts.verify_ms` grows, or when it is missing, and `doctor` reports hooks with a timeout too short as out of date. Before, a raised `verify_ms` left Claude Code killing the stop check at 70 s.
- SETUP.md no longer says hook rules run after every edit: they run when the agent stops.
- `add` and `list --catalog` find the catalog however its GitHub URL is cased (`Syv-AI/rulecast`), rather than add a second entry that fails validation. `list --catalog` labels catalog rules with the catalog, not `local`.
- The README's pre-commit `rev` and Status follow the version (`pnpm sync-version`). They said 0.4.
- SETUP.md and CONVENTIONS.md publish the page as an artifact only where the agent has a tool for it.
- A damaged line in a session store is skipped. Before, one such line dropped the session's memory, and with it the stop check, for every later hook of that session.
- The session lock is kept fresh while its holder works and released only by its holder, so a holder slower than the 5 s stale limit no longer lets other hook processes in alongside it.
- `init` judges a hook that runs a package script by that script (one level), and one that runs a script it cannot see into as "may change files", naming it (`modifies: null` and `runs` in JSON). It sees past package-manager flags and workspace selectors (`pnpm --filter web lint`, `yarn workspace web lint`), treats turbo, nx, lerna, npm-run-all and concurrently as unknown, and counts black, isort and `ruff format` as writers unless they `--check`. Before, `npm run lint` running `biome --write` was offered as read-only.
- Session stores no longer grow by the whole dirty tree twice per shell call: a tree state is written as a reference to one the store already holds, or as its change from the agent's last one. With 2000 shell calls and 30 dirty files, a store went from 40 MB to 1 MB, and reading it from 375 ms to 27 ms on every hook.
- `init`, `install` and `doctor` plan the agent hooks in one place. `init` now completes a partial install where it is, as `install` does, instead of writing a second set into the shared settings, and `doctor` judges the stop timeout by the largest `verify_ms` of every config the hooks serve.
