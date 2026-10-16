---
"@syv-ai/rulecast": minor
---

New command: `rulecast stats [--since 30d] [--format terminal|json]`. It shows, per rule, what became of the findings rulecast reported to agents: how many fired, were blocked at a stop, were fixed (and after how many turns), were left in place at a stop, or were silenced with `rulecast-ignore`. It flags noisy rules, the ones the agent keeps hitting or silencing, and lists rules that never fired. `--format json` is a documented contract (`agents/reference/output.md`), for loops that improve rules.

To get these numbers, agent hooks now append a small record per edit check, refused write and stop to `findings.jsonl` in the project's cache directory. A record holds finding ids, rule ids, file paths and line numbers only, never code or messages, and never leaves the machine. The file rotates at 4 MiB, a hook never fails because it could not be written, and `rulecast clean` removes it. `rulecast run`, git hooks and CI write nothing to it.
