---
"@syv-ai/rulecast": patch
---

In Claude Code's auto mode, a subagent's findings now reach it at its hand-back. Auto mode ends a subagent with the SubagentHandback tool, and a block at its SubagentStop came too late: Claude Code recorded it and the subagent never resumed. rulecast now checks the subagent when it hands back and refuses the hand-back with the findings, so it fixes them or puts them in its report. Claude Code retries a refused hand-back only a few times before the report is lost, so it is refused at most once (unattended, once more to report), whatever `max_blocks` says. The SubagentStop after a hand-back is no longer checked.
