---
"@syv-ai/rulecast": minor
---

New ways to measure a rule before you switch it on, and fixes for agents that share a working tree.

- `rulecast replay claude-code` judges your recent Claude Code sessions from their transcripts: what each rule would have told the agent at each edit and stop. llm rules run only with `--llm --yes`.
- `rulecast test <id> --history [--commits N]` judges a rule on recent commits, on what each one added. `--label` writes the findings for you to mark real or false, which gives a precision. An llm rule prints its cost and runs only with `--yes`.
- `rulecast stats` adds `runs`, `neverRan` and `stopBlocks`: a rule that never ran is told apart from one that ran and never fired, and each blocking rule's block rate is shown by the number of files at the stop.
- A Bash command is no longer blamed for another agent's Edit or Write made while it ran, in the same session or another. A protected file changed during an overlap is answered with "undo only your change", never `git checkout`.
- Lines a pull or merge brings into a file the agent edited are no longer counted as the agent's.
- Every finding names its file and line, even when the rule's message leaves out `{{file}}`.
- A `.rulecast-config.yaml` in your home directory no longer makes every repository below it one project, and `init` creates a repository's own config when the nearest one is above it.
- Hooks: git never takes the index lock, tree snapshots give up after 3 s, a stop's work shares one `verify_ms`, session logs are written under a lock, and regex, ast-grep and llm rules skip binary files.
- `agents/`: how to word an llm rule's question, llm rules measured with `--history` and started as warnings, and every convention's outcome accounted for when drafting rules.
