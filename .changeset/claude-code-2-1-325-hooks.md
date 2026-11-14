---
"@syv-ai/rulecast": patch
---

Claude Code hooks catch up with Claude Code 2.1.325. Re-run `rulecast install` where sessions start; `rulecast doctor` says the hooks are out of date until then.

- **Hand-backs are not prompts.** In auto mode a subagent's report reaches the main agent as a prompt starting `<agent-message`, and each one reset the stop gate as if the user had written it. Those, and task notifications, no longer count. When Claude Code sends the prompt's `source`, only `user` and `sdk` prompts count.
- **Internal agents under `claude --agent`.** `/compact`, `/btw` and prompt suggestions run as subagents of the session's own agent type, and their stops were checked like real subagents'. A subagent stop or start whose type is the session's own is now left alone.
- **Work still running at a stop.** When the main agent stops while a background subagent it started is still running in the same checkout, that subagent's files are left to it, and checking files changed outside the agents' tool calls waits for a later stop; the stop says so in one line. A running background shell command (a dev server, a watcher) defers nothing. A subagent's own stop ignores the task list, which describes the parent session.
- **Worktrees.** The configs of a worktree the agent enters with EnterWorktree, and of an isolated subagent's worktree, count as its projects from then on, not only once it edits there.
- **More edit tools.** NotebookEdit and MultiEdit edits are checked. A Read that fails because the file is too large still delivers the file's conventions.
- New hook groups: `PreToolUse (SubagentHandback)`, `PostToolUse (EnterWorktree|ExitWorktree)`, `PostToolUseFailure (Read)` and `SubagentStart`. The edit group's matcher becomes `Edit|Write|MultiEdit|NotebookEdit`, widened in place.
