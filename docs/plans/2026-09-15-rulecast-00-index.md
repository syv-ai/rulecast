# rulecast — implementation plans

Spec: `docs/specs/2026-09-15-rulecast-design.md`

The spec is split into five plans. Each produces working, tested software on its own and builds on the previous one.

| # | Plan | Delivers | Spec sections | Status |
|---|---|---|---|---|
| 1 | Core + CLI | Package scaffold, compile, `regex`/`path` detectors, detection runner, baseline, session, delivery, pipeline, `rulecast check` and `rulecast validate` | §3–§11, §12 (CLI), §14, §15 (compile/baseline/session) | Done (2026-09-16), in five parts executed in order: `2026-09-15-rulecast-01a-compile.md` (tasks 1–8), `01b-detection.md` (9–14), `01c-baseline.md` (15–20), `01d-session-delivery.md` (21–27), `01e-pipeline-cli.md` (28–32) |
| 2 | Claude Code | Claude Code adapter from recorded payloads, `rulecast hook`, `rulecast init`, `rulecast warm` + detached warm-up, perf test | §12 (adapter), §13 | Written after plan 1 (payloads must be recorded first) |
| 3 | Structural and external detectors | `ast-grep`, `command`, `linter` (ruff, oxlint, eslint); exported detector and adapter contract suites | §6, §15 | Written after plan 1 |
| 4 | LLM detector | `llm` detector, providers, cache, budget | §6 (`llm`) | Written after plan 3 |
| 5 | Distribution | `rulecast doctor`, standalone binary, release pipeline, `SETUP.md`, aka-agents2 dogfooding | §5 (doctor), §16, §17 | Written after plan 4 |

The `design-system` detector (§18) gets its own spec after 0.1.

## Conventions for all plans

- Package manager: pnpm. Node ≥ 20. ESM only.
- Tests: vitest, colocated under `test/` mirroring `src/`.
- No module-level mutable state anywhere in `src/`. Anything a module needs is passed in.
- Commit after every task. Commit messages end with the line `Claude goes brr.. via Dash`.
