---
"@syv-ai/rulecast": minor
---

Subagents that work in their own worktrees no longer end up in each other's checks, and a new `subagent_projects` setting decides whether the main agent checks their worktrees (#68, #73).

rulecast remembers which projects a session worked in, so a stop or a shell call, which name no file, knows where to check. Until now that memory was shared by every agent in the session. Once a subagent edited a file in its own worktree, every other agent's shell calls and stops ran there too:

- A subagent's shell call was compared against the lead's worktree and its siblings' worktrees, so their writes during the call were held to it.
- The main agent's shell calls got the "another agent ran a shell command in this working tree" notice, which told it to give each agent its own worktree when it already had. The subagent's changed files were also treated as the main agent's edits, so it got their findings and touch context.
- The main agent's stop sent every subagent's files to `llm` rules a second time, and could hit `llm.max_files_per_verify` on work it can't act on.

Now each project is remembered for the agent that worked in it:

- A subagent's shell calls and stop reach the projects above where it is, the ones the session start found below where it is, and the ones it worked in itself. Never another agent's, and never one in another checkout of the repository: a subagent in `<repo>/.claude/worktrees/x` no longer reaches the lead's config at `<repo>`.
- A project counts as an agent's once it edits a file there, or a shell command of its changes one there. Reading a file no longer does, so the main agent reading a subagent's files doesn't pull that worktree into its own checks.
- The main agent's shell calls and stop still reach the projects only its subagents worked in, as a backstop for a subagent that stopped with findings left. To leave a subagent's worktree to its own hooks, set this in that worktree's `.rulecast-config.yaml`:

  ```yaml
  subagent_projects: exclude
  ```

  With the default, `include`, the notice for a shared working tree now names this setting and no longer suggests separate worktrees.
- A prompt still reaches every project the session worked in, since it only resets counters.

A worktree inside its own repository is now a project boundary: a file in `<repo>/.claude/worktrees/x` is judged by the configs in that worktree and above the repository, not by the main checkout's config at `<repo>`. This holds for agent hooks and for `rulecast run`. A nested repository of its own, such as a submodule or a home directory kept in git, still gets the configs above it, and so do worktrees below a bare repository's directory (`proj/.git` naming `./.bare`).

Breaking: the file that records a session's projects has a new format. A session that was already running when you upgrade forgets the projects it worked in outside the directories it started in and is in now. A new session is not affected.
