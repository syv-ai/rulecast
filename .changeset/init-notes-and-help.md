---
"@syv-ai/rulecast": patch
---

`rulecast init` and the command help now say what is true.

- `rulecast init --help` lists `--linters`. init already took it, to run your project's own linters (such as `linter/ruff`) as rules, and `init --dry-run` lists the ones it found, but the help left it out.
- In a monorepo you might run `rulecast init --no-agents` in one package, because the agent hooks are installed higher up, where your sessions start. init used to say "No agent hooks: rulecast will not run in your agent until you run rulecast install", even though those hooks already run this package's rules. init now looks for agent hooks in the directories above, up to the top of the repository. When it finds them, it names them and says they reach this config for sessions started there. It still gives the old note when no hooks reach the config.
- `rulecast warm` builds detector caches ahead of time. Its summary in the help now says that no built-in detector needs it yet. With only built-in detectors, it prints "nothing to warm".
