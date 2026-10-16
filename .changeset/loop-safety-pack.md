---
"@syv-ai/rulecast": minor
---

A new catalog pack, `loop-safety`, for agents that run with nobody watching: Claude Code's `/goal`, `claude -p`, scheduled tasks, CI. When an agent's goal is "the tests pass", the cheapest way there is often to make the tests or the checker say yes. The pack catches those shortcuts as they are written:

- `loop-safety/no-skipped-tests-python`, `-ts` and `-js`: a new pytest skip or xfail, a unittest skip, or a `.skip`, `.only`, `.todo`, `xit` or `fit` in a test file.
- `loop-safety/no-new-suppressions`: a new `noqa`, `type: ignore`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `biome-ignore` or coverage pragma.
- `loop-safety/no-lowered-thresholds`: an edit to a coverage threshold or to `--max-warnings`.
- `loop-safety/protected-loop-config`: an edit to CI workflows, git hooks, `.rulecast-config.yaml` or `.claude/settings.json`.

Only what the change adds is flagged, never what was already there. Each finding tells the agent to fix the code, or to leave the test failing and report why it believes the test is wrong, and links the pack's doc, which explains how a developer makes such a change on purpose. The rules are warnings while someone is watching. In unattended mode they are errors, and edits to the loop's configuration are refused before they are written. `rulecast init` offers the pack but never ticks it for you, unless the config already says `mode: unattended`. `rulecast init --rules loop-safety` installs all of it.

Two rule-format changes come with it:

- `escalate: true` on a rule makes it an error in unattended mode, the same as listing it in `unattended.escalate`. Set `escalate: false` on a catalog rule's entry to turn that off.
- A rule's `minimum_rulecast_version` is now checked before the rest of the rule. A rule that uses a key added in a newer rulecast now says to upgrade, instead of failing on the key it does not know.
