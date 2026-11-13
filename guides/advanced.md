# Several agents and git

Most projects need none of this.

## Several agents at once

- Each subagent's stop checks only the files it edited, so it is never asked to fix another agent's code.
- The main agent's stop checks everything the session changed, so a problem that only shows when two subagents' changes meet is caught there. A file two subagents both edit can block either.
- A change no agent's tool call made, such as your own edit, is reported at the main agent's stop.

With agents in parallel in one working tree, a file one agent changed with Edit or Write stays that agent's even while another's shell command runs. What two agents' shell commands change at the same time can't be told apart: both are held to it, and neither is told to `git checkout` a protected file the other may have written. Give parallel agents their own worktrees (in Claude Code, a subagent with `isolation: worktree`).

A subagent in its own worktree is checked there by its own stop. By default the main agent's shell calls and stop check that worktree too, as a backstop, so the main agent may see findings on the subagent's files. To leave each worktree to its subagent, set this in the worktree's config, which is usually the same committed file:

```yaml
subagent_projects: exclude
```

rulecast sees an agent's shell commands in its working directory. A subagent that makes its own worktree, say with `git worktree add` from a chosen commit on a named branch, and then runs `cd <worktree> && …` from the lead's directory, works where rulecast doesn't look: its shell edits there are neither checked nor logged. Its Edit and Write calls are still checked, since they name the file. Have such a subagent switch into its worktree first. In Claude Code that is the EnterWorktree tool with the worktree's path, which keeps the commit, the branch and the worktree. rulecast tells an agent once per checkout when a command of its works in another checkout of the repository.

## Git operations during a turn

A commit, pull, merge or checkout is not an edit. Lines a pull or merge brings into a file the agent edited are not counted as the agent's, as long as their commits predate the operation. The agent's own commits stay its own.

One gap: a command that edits files and commits them in one go (`fmt && git commit`) counts only as a git operation, so files it alone changed are not checked.
