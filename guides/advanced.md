# Several agents and git

Most projects need none of this.

## Several agents at once

- Each subagent's stop checks only the files it edited, so it is never asked to fix another agent's code.
- The main agent's stop checks everything the session changed, so a problem that only shows when two subagents' changes meet is caught there. A file two subagents both edit can block either.
- A change no agent's tool call made, such as your own edit, is reported at the main agent's stop.

With agents in parallel in one working tree, a file one agent changed with Edit or Write stays that agent's even while another's shell command runs. What two agents' shell commands change at the same time can't be told apart: both are held to it, and neither is told to `git checkout` a protected file the other may have written. Give parallel agents their own worktrees (in Claude Code, a subagent with `isolation: worktree`).

## Git operations during a turn

A commit, pull, merge or checkout is not an edit. Lines a pull or merge brings into a file the agent edited are not counted as the agent's, as long as their commits predate the operation. The agent's own commits stay its own.

One gap: a command that edits files and commits them in one go (`fmt && git commit`) counts only as a git operation, so files it alone changed are not checked.
