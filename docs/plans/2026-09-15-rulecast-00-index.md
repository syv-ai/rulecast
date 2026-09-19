# rulecast — implementation plans

Spec: `docs/specs/2026-09-15-rulecast-design.md`

The spec is split into seven plans. Each produces working, tested software on its own and builds on the previous one. Plans 3 and 4 were added on 2026-09-19 for the pre-commit-style config and the interactive `init` (spec revision of 2026-09-16). The structural detectors, LLM and distribution plans moved from 3–5 to 5–7.

| # | Plan | Delivers | Spec sections | Status |
|---|---|---|---|---|
| 1 | Core + CLI | Package scaffold, compile, `regex`/`path` detectors, detection runner, baseline, session, delivery, pipeline, `rulecast check` and `rulecast validate` | §3–§11, §12 (CLI), §14, §15 (compile/baseline/session) | Done (2026-09-16), in five parts executed in order: `2026-09-15-rulecast-01a-compile.md` (tasks 1–8), `01b-detection.md` (9–14), `01c-baseline.md` (15–20), `01d-session-delivery.md` (21–27), `01e-pipeline-cli.md` (28–32) |
| 2 | Claude Code | Claude Code adapter from recorded payloads, `rulecast hook`, `rulecast init`, `rulecast warm` + detached warm-up, perf test | §12 (adapter), §13 | Done (2026-09-16), in two parts executed in order: `2026-09-16-rulecast-02a-adapter.md` (tasks 1–7), `02b-hook-init-warm.md` (tasks 8–13); edit hook p50 111 ms, p95 118 ms on an Apple M3 Pro (regex and path rules only) |
| 3 | Pre-commit-style config and rule repos | Monorepo layout, `.rulecast-config.yaml` and rule repo manifests, file-type tags and regex filters, reference roots, the user cache (`$RULECAST_HOME`), repo fetching, `run` (replaces `check`), `validate [file…]`, `install`/`uninstall`, `autoupdate`, `try-repo`, `clean`, re-delivery after compaction | §3–§5, §7, §9, §12 (CLI, cache and state), §14, §16 | Done (2026-09-19), in five parts executed in order: `2026-09-19-rulecast-03a-monorepo-config.md` (tasks 1–5), `03b-cache-repos.md` (6–8), `03c-compile.md` (9–10), `03d-commands.md` (11–16), `03e-repos-compaction.md` (17–19); edit hook p50 82 ms, p95 105 ms on an Apple M3 Pro |
| 4 | Interactive init | Catalog rule packages (`rules-general`, `rules-python`, `rules-react`) and the generated root manifest, agent docs under `agents/`, interactive `rulecast init` | §4 (rule repos), §12 (`init`, agent docs), §15 (init) | Written, in two parts executed in order: `2026-09-19-rulecast-04a-catalog-docs.md` (tasks 1–2), `04b-init.md` (3–9) |
| 5 | Structural and external detectors | `ast-grep`, `command`, `linter` (ruff, oxlint, eslint); exported detector and adapter contract suites | §6, §15 | Written after plan 4 |
| 6 | LLM detector | `llm` detector, providers, cache, budget | §6 (`llm`) | Written after plan 5 |
| 7 | Distribution | `rulecast doctor`, standalone binary, release pipeline, public repository (needed by the drafting prompt's raw GitHub links), aka-agents2 dogfooding | §5 (doctor), §16, §17 | Written after plan 6 |

The `design-system` detector (§18) gets its own spec after 0.1.

## Conventions for all plans

- Package manager: pnpm (workspace). Node ≥ 20. ESM only.
- The CLI package lives in `packages/rulecast/`. Plans 1 and 2 predate the move: their `src/…` and `test/…` paths are now under `packages/rulecast/`.
- Tests: vitest, under `packages/rulecast/test/` mirroring `src/`.
- No module-level mutable state anywhere in `src/`. Anything a module needs is passed in.
- Commit after every task. Commit messages end with the line `Claude goes brr.. via Dash`.
