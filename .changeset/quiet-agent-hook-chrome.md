---
"@syv-ai/rulecast": minor
---

What rulecast says to the user in agent hooks, as opposed to the findings and docs you chose, is now one short line each: `RC <level>: <message>`, with no "rulecast problems:" heading and no config paths. A line from a project other than the session's own is tagged with its directory, e.g. `RC warning [validation-rename]: …`.

- A checkout only the main agent's subagents worked in (a subagent's worktree) contributes only its findings to the main agent's stop, never its warnings or notices. Its own stops say those.
- The llm file-budget line ("checked 10 files; N were not checked") is no longer said in agent hooks; it goes to the debug log. The CLI still says it.
- Warnings that don't fit their share of the budget become one line, "N more — run rulecast doctor", and are recorded as said. Before, a cut warning came back at every stop, cut mid-sentence.
- Shorter texts: "config changed this session; review with git diff .rulecast-config.yaml", "findings in files changed outside the agent's tool calls (not blocking)", "the agent stopped with these findings unresolved (stop limit reached)".
