---
"@syv-ai/rulecast": patch
---

`SETUP.md` no longer has the agent ask every setup question in one call (#80). Claude Code's question tool takes at most 4 questions per call, and the go-ahead question counts toward that. The agent now splits the questions over two calls in one turn, with the go-ahead last in the second, and asks any that still don't fit in the next turn.
