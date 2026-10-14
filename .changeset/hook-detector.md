---
"@syv-ai/rulecast": minor
---

A new `hook` detector runs a hook the project already declares, so its findings reach the agent with the doc section the rule cites:

- `hook: { pre-commit: mypy }` runs a hook from `.pre-commit-config.yaml` through prek when it is installed, else pre-commit, on the rule's files (`run <id> --files …`, which never stashes). A hook that only runs at another stage is run at that stage.
- `hook: { lefthook: pre-commit/typecheck }` runs a lefthook job's own command with the rule's files in place of `{staged_files}`, `{files}`, `{all_files}` and `{push_files}`, without `lefthook run`, which can install git hooks.
- `output` (default `{ lines: gcc }`), `rules` and `exit_codes` work as for `command`.
- A hook that changes a file (a formatter) has the file put back, and each changed file is a finding: "<hook> would change this file". rulecast never rewrites an agent's file behind its back.
- A hook that fails with output no format reads is one finding carrying its first lines.

Hook rules run at verify unless `stages` says otherwise, and in a staged run they run on the working tree when the rule's files there match the index. husky hooks are shell scripts with nothing structured to read: use `command` with the script's command.
