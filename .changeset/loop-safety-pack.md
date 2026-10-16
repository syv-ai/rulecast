---
"@syv-ai/rulecast": minor
---

A new catalog pack, `loop-safety`, for agents that run with nobody watching, such as Claude Code's `/goal`, `claude -p`, scheduled tasks and CI. When an agent's goal is "the tests pass", the cheapest way there is often to make the tests or the checker say yes. The pack catches those shortcuts as they are written:

- `loop-safety/no-skipped-tests-python`, `-ts` and `-js`: a new pytest skip or xfail, a unittest skip, or a `.skip`, `.only`, `.todo`, `.failing`, `xit`, `fit` or `this.skip()` in a test file.
- `loop-safety/no-deleted-assertions-python`, `-ts` and `-js`: a test file with fewer assertions than before the change (`assert`, unittest and mock `assert*` calls, `pytest.raises`, `expect()`, `assert()`). A commented-out assertion counts as removed.
- `loop-safety/no-new-suppressions`: a new `noqa`, `type: ignore`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `biome-ignore` or coverage pragma.
- `loop-safety/no-config-suppressions-python` and `-js`: the same shortcut in a checker's config, such as a mypy `ignore_missing_imports` override, a ruff or flake8 `ignore` entry, pytest `--deselect` in `addopts`, an ESLint or Biome rule set to `"off"`, or `"strict": false` in `tsconfig.json`.
- `loop-safety/no-lowered-thresholds`: an edit to a coverage threshold or to `--max-warnings`.
- `loop-safety/protected-loop-config`: an edit to CI workflows, git hooks, `.rulecast-config.yaml` or `.claude/settings.json`.

Only what the change adds is flagged, never what was already there; the deleted-assertion rules compare the file's assertion count with its baseline instead. Each finding tells the agent to fix the code, or to leave the test failing and report why it believes the test is wrong, and links the pack's doc, which explains how a developer makes such a change on purpose. The rules are warnings while someone is watching. In unattended mode (set `RULECAST_MODE=unattended` or `mode: unattended` for `/goal`, `claude -p` and scheduled runs; on by itself in CI) they are errors, and edits to the loop's configuration are refused before they are written. `rulecast init` offers the pack but never ticks it for you, unless the config already says `mode: unattended`. `rulecast init --rules loop-safety` installs all of it.

Three rule-format changes come with it:

- `scope: removed`: a match is something the code should keep, and the finding is a file with fewer matches than at its baseline: the session's, `run --from-ref`'s merge base, or `HEAD` in a staged run. It needs a `regex` or `ast-grep` detector and reports nothing without a baseline (`run --all-files`).
- `escalate: true` on a rule makes it an error in unattended mode, the same as listing it in `unattended.escalate`. Set `escalate: false` on a catalog rule's entry to turn that off.
- A rule's `minimum_rulecast_version` is now checked before the rest of the rule. A rule that uses a key added in a newer rulecast now says to upgrade, instead of failing on the key it does not know.
