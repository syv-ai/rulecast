---
"@syv-ai/rulecast": patch
---

A subagent's stop is now blocked only by findings in files that subagent edited. Before, it could be blocked by a file the main agent or another subagent changed, and was then asked to fix code it never touched. The main agent's stop still checks every file the session changed. A change no agent's tool call made is reported at the main agent's stop, and at a subagent's only when that subagent's own shell calls found it.

Agents running in parallel in one working tree that change files with the shell can still be blamed for each other's writes: a shell command is held to every file that changed while it ran. Give parallel agents their own worktrees. An agent whose shell call overlaps another agent's, and that is held to files changed while it ran, is now told so, once per session, with the same advice.
