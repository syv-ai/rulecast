---
"@syv-ai/rulecast": patch
---

Docs only, after an audit of every claim against the code.

- The README's `refuse_write` example gains the `name` every local rule needs: before, it failed `rulecast validate`.
- Getting started and the no-URL fallback say setup installs rulecast before `init`.
- A protected file written through Bash holds the agent's stop up to the stop limit, not without end.
- Exit codes: `test` exits 1 on a failed example, `baseline` 3 when a rule could not run.
- `llm` rules can use the config's `llm.model`; the model aliases do not map for `openai-compatible`.
- `gitleaks` reads staged content on stdin; `command` reads rdjson.
- SETUP.md describes `modifies: null` and `runs` in init's JSON; output.md says init's JSON is not a contract.
- `refuse_write` needs `edit` among the rule's stages; `rulecast install` after raising `verify_ms` goes where sessions start.
- loops.md's stats recipe no longer fails when the config did not fully compile.
- Performance and Install state the budgets `pnpm perf` checks instead of measured timings.
