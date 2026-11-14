---
"@syv-ai/rulecast": minor
---

A Claude Code subagent now starts with the paths of the project's convention docs: the `conventions` file or folder and the files the project's rules cite, at most 8, never their content. It arrives through the SubagentStart hook, in the subagent's own context. The new config key `subagent_docs: false` turns it off for a project.
