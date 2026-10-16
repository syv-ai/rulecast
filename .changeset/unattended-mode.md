---
"@syv-ai/rulecast": minor
---

Unattended mode, for agent runs that nobody is watching, such as Claude Code's `/goal`, `claude -p`, scheduled tasks and CI. Until now the stop gate blocked a stop once per user prompt. A loop sends one prompt, so it got one block per run, and after that the findings went to a message that nobody read.

Set `RULECAST_MODE=unattended`, or `mode: unattended` in `.rulecast-config.yaml`. The environment variable wins over the config. When neither is set, `CI` or `GITHUB_ACTIONS` turns the mode on. In unattended mode:

- Every stop with new error findings is blocked, up to `unattended.max_blocks` (default 10) per prompt.
- A finding that has blocked two stops is reported instead of blocked again, so a false positive cannot loop. A protected file changed with the shell keeps blocking until it is reverted.
- When the budget is spent, or only repeated findings are left, the agent is held once more and told to record the findings as unresolved in its final report. Before, they went only to a message for the user.
- The block message tells the agent that nobody is there to ask. If it disputes a finding, it records the finding in the run's decisions file or final report instead of asking the user.
- A `rulecast-ignore` comment the agent adds or changes during the run silences nothing, in the stop gate and in `refuse_write`'s refusal. Nobody is there to agree to it, so the finding blocks and is reported like any other. Comments already in the code keep working, even when the agent edits the code they cover.
- `unattended.escalate: [rule-id, ...]` makes chosen warning rules errors, and `refuse_write: unattended` makes a rule refuse writes only in this mode.

The mode applies to agent hooks only. `rulecast run`, in a git hook or a CI job, always runs the rules as written, so a CI job's exit code does not change. `rulecast doctor` shows the active mode and where it came from. Attended behaviour is unchanged.
