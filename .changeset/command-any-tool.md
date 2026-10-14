---
"@syv-ai/rulecast": minor
---

A `command` rule can run any tool that works as a pre-commit hook, with config only:

- `output` reads `sarif`, `json`, `checkstyle`, `gitlab` (code-quality JSON, which ty prints), `rdjson`, or lines: `{ lines: gcc }`, `{ lines: gcc-nocol }`, `{ lines: msbuild }`, or `{ lines: { pattern: "<regex with named groups file, line, message…>" } }`.
- `stream: stderr | both` reads a tool that reports on stderr.
- `rules: [...]` keeps only findings with those rule ids.
- `exit_codes: { error: [2, 101] }` names the exit codes that mean the tool failed; such a run is a rule error carrying the tool's stderr. Other exit codes are findings-or-clean, as before.
- `scope: project` runs the tool on the whole project without files and keeps the findings in the rule's files: type checkers, dead-code and duplication tools. It runs at verify only unless `stages` says otherwise. In a staged `rulecast run` it runs on the working tree when the rule's files there match the index, and is skipped with a warning naming the files when they don't. rulecast never stashes.

Rules that call the same command share one run, so three semgrep rules scan once.
