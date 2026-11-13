---
"@syv-ai/rulecast": minor
---

`rulecast doctor --time` reports whether each tool-backed rule fits in the stop check's time budget (#83). It runs each rule whose detector runs a tool (a hook, a command, a linter) once, over every file the rule matches, which is the most an agent's stop can hand it. A new `timing` section then reports its wall time against `timeouts.verify_ms`, for example `mypy-check — 41.2 s of 60.0 s on 928 files`. A rule over the budget is a warning, which suggests leaving it off agent stops or raising `timeouts.verify_ms`. Before, a whole-project type checker or test suite had to be turned on before you found out it was too slow. In-process detectors (regex, ast-grep) take milliseconds and `llm` rules cost money per run, so neither is timed. `SETUP.md` has the agent run it after setup.
