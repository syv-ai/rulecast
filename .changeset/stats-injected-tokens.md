---
"@syv-ai/rulecast": minor
---

`rulecast stats` shows how much rulecast put before the agents, as ≈ tokens (characters ÷ 4). It counts what reached the model (a hook's context, a stop's reason, a refused write's reason), never what only the user sees, and breaks it down:
- by event (Read, Edit, shell, Stop, refused write, compact);
- the part re-delivered after a compact;
- each session's total beside its turns, and its tokens per turn;
- the doc sections that cost the most, with the rules that cite them.

It flags any single answer over 2,000 tokens and any session over 1,000 tokens a turn. `--format json` carries it as `injected`. The hooks record it per project, in `injected.jsonl` next to the findings log.
