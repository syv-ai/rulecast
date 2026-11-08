---
"@syv-ai/rulecast": patch
---

`rulecast help` lists the commands most projects use. `baseline`, `replay`, `autoupdate`, `try-repo`, `clean`, `warm` and `hook` are named on one line, and `rulecast help --all` lists them with what they do. Every command works as before, and `rulecast <command> --help` is unchanged.

The README and the docs site have a new Advanced section and page. It holds several agents in one working tree, git operations during a turn, fresh environments, how staged and `--to-ref` runs hand files to tools, committed baselines, and the loop-safety pack. Links to `#fresh-environments` and `#a-committed-baseline` still work. Text about parallel agents that was under `#agents` is now under `#several-agents-at-once`.

The README's command table is split into commands and advanced commands. "Turning a rule off" now sits next to the other rule sections.
