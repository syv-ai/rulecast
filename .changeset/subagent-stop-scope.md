---
"@syv-ai/rulecast": patch
---

A subagent's stop is now blocked only by findings in files that subagent edited. Before, it could be blocked by a file the main agent or another subagent changed, and was then asked to fix code it never touched. The main agent's stop still checks every file the session changed.

A file another agent writes with its Edit or Write tool while a shell command runs is no longer blamed on that command. Two agents' shell commands running at the same time in one working tree still can't be told apart; give parallel agents their own worktrees.
