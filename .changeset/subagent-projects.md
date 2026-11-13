---
"@syv-ai/rulecast": minor
---

Subagents that work in their own worktrees no longer end up in each other's checks, and a new `subagent_projects` setting decides whether the main agent checks their worktrees (#68, #73).

rulecast remembers which projects a session worked in, so a stop or a shell call, which name no file, knows where to check. Until now that memory was shared by every agent in the session. Once a subagent edited a file in its own worktree, every other agent's shell calls and stops ran there too:

- A subagent's shell call was compared against the lead's worktree and its siblings' worktrees, so their writes during the call were held to it.
- The main agent's shell calls got the "another agent ran a shell command in this working tree" notice, which told it to give each agent its own worktree when it already had. The subagent's changed files were also treated as the main agent's edits, so it got their findings and touch context.
- The main agent's stop sent every subagent's files to `llm` rules a second time, and could hit `llm.max_files_per_verify` on work it can't act on.

Now each project is remembered for the agent that worked in it:

- A subagent's shell calls and stop reach only the projects above where it is and the ones it worked in itself. Never another agent's.
- The main agent's shell calls and stop still reach the projects only its subagents worked in, as a backstop for a subagent that stopped with findings left. To leave a subagent's worktree to its own hooks, set this in that worktree's `.rulecast-config.yaml`:

  ```yaml
  subagent_projects: exclude
  ```

  With the default, `include`, the notice for a shared working tree now names this setting and no longer suggests separate worktrees.
- A prompt still reaches every project the session worked in, since it only resets counters.

Breaking: the file that records a session's projects has a new format. A session that was already running when you upgrade forgets the projects it worked in outside the directories it started in and is in now. A new session is not affected.
