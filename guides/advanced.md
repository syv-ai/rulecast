# Several agents and git

Most projects need none of this.

## Several agents at once

- Each subagent's stop checks only the files it edited, so it is never asked to fix another agent's code.
- The main agent's stop checks everything the session changed, so a problem that only shows when two subagents' changes meet is caught there. A file two subagents both edit can block either.
- A change no agent's tool call made, such as your own edit, is reported at the main agent's stop.
- When the main agent stops while a background subagent it started is still running in the same checkout, the files only that subagent edited are left to it, and files changed outside the agents' tool calls are checked at a later stop; the stop says so. A background shell command that keeps running, such as a dev server, doesn't hold anything back.
- Each subagent starts with the paths of the project's convention docs: the `conventions` file or folder, and the files its rules cite. It gets the paths only, not the docs' content. `subagent_docs: false` in a config turns this off.
- In Claude Code's auto mode a subagent ends by handing its report back. rulecast checks it there and refuses the hand-back once with the findings, so the subagent fixes them or puts them in its report ([details](../agents/reference/rule-format.md#unattended-mode)).

With agents in parallel in one working tree, a file one agent changed with Edit or Write stays that agent's even while another's shell command runs. What two agents' shell commands change at the same time can't be told apart: both are held to it, and neither is told to `git checkout` a protected file the other may have written. Give parallel agents their own worktrees (in Claude Code, a subagent with `isolation: worktree`).

A subagent in its own worktree is checked there by its own stop, and not in the lead's checkout, even when its worktree sits inside it (`<repo>/.claude/worktrees/x`). By default the main agent's shell calls and stop check that worktree too, as a backstop, so the main agent may see findings on the subagent's files. Reading the subagent's files doesn't change that, but once the main agent edits a file there with Edit or Write, the worktree counts as its own and `subagent_projects` no longer applies to it. To leave each worktree to its subagent, set this in the worktree's config, which is usually the same committed file:

```yaml
subagent_projects: exclude
```

rulecast sees an agent's shell commands in its working directory. A subagent that makes its own worktree, say with `git worktree add` from a chosen commit on a named branch, and then runs `cd <worktree> && …` from the lead's directory, works where rulecast doesn't look: its shell edits there are neither checked nor logged. Its Edit and Write calls are still checked, since they name the file. Have such a subagent switch into its worktree first. In Claude Code that is the EnterWorktree tool with the worktree's path, which keeps the commit, the branch and the worktree. rulecast tells an agent once per checkout when a command of its works in another checkout of the repository that has a config, is on a branch, and that the command's checks did not cover. A checkout with a detached HEAD, such as a throwaway copy made with `git worktree add --detach` to run tests in, is left out. It reads where the command works from `cd`, `pushd`, `git -C` and `make -C`, and from the paths in it: absolute, `~/`, and relative ones with a slash. It skips paths built from shell variables, paths inside quoted text with spaces such as a commit message, and here-document bodies.

When the agent moves into a worktree with EnterWorktree, the configs there count as its projects from then on, so its stop checks them even after ExitWorktree. The same goes for a subagent with `isolation: worktree`, from the moment it starts.

## Where sessions start

Claude Code reads `.claude/settings.json` only in the directory a session starts in. Start Claude in a subdirectory and the hooks in the repository's top aren't read, so no rules run. `rulecast doctor`, run in that subdirectory, says so. Either start sessions where the hooks are, or run `rulecast install` in the subdirectory too.

Personal hooks (`rulecast install --scope personal`) have one file: `.claude/settings.local.json` at the top of the checkout, or the main checkout's from a worktree. Claude Code reads it for every session in the checkout and its worktrees, wherever the session starts. A personal install writes or upgrades that file from any directory, and never treats a `settings.json` as installed. The hooks name the script by its absolute path, so they work from anywhere. A `settings.local.json` anywhere else is never read by Claude Code: `rulecast doctor` calls it a leftover, and `rulecast uninstall --scope personal` in its directory removes it.

Shared hooks (`rulecast install`) go in `.claude/settings.json` in the directory the install runs in, and serve the sessions started there.

Claude Code merges only identical hook commands, so the two would run rulecast twice for the sessions both serve. Install never removes hooks from a file you didn't name. Instead:

- A personal install refuses while shared rulecast hooks exist where sessions of this checkout start: the directory it runs in, the top, each directory below the top with a config, and each worktree's top.
- A shared install refuses while the personal file has rulecast hooks.
- Each refusal names the files, and the `rulecast uninstall --scope <x>` to run and where (`in ..`). `rulecast doctor` reports both scopes at once as an error, with the same commands.

A session started with `claude --worktree` runs in a fresh worktree, which has no `node_modules`. The hook script then runs the main checkout's `node_modules/.bin/rulecast`, found from the worktree's `.git` file, before trying a rulecast on the PATH. `rulecast doctor` in the worktree says which one runs. A worktree branched from a commit older than the hooks has none of them.

## Git operations during a turn

A commit, pull, merge or checkout is not an edit. Lines a pull or merge brings into a file the agent edited are not counted as the agent's, as long as their commits predate the operation. The agent's own commits stay its own.

One gap: a command that edits files and commits them in one go (`fmt && git commit`) counts only as a git operation, so files it alone changed are not checked.
