# Linter output

Recorded 2026-09-20 by running each tool from a project root over one file and capturing stdout.
`__ROOT__` stands in for the project's absolute path: ruff and eslint report absolute paths,
oxlint reports paths relative to its own working directory, and the parsers handle both.

`test/helpers/linters.ts` substitutes `__ROOT__` and replays these through a stub placed in a
fixture's `node_modules/.bin`, which is where the detector looks first.

## Files

| File | Tool | Command | Input |
|---|---|---|---|
| `ruff.json` | ruff 0.14.0 | `ruff check --output-format json --isolated --select F401,T201 --force-exclude -- app/a.py` | `import os` + `print("x")` |
| `oxlint.json` | oxlint 1.83.0 | `oxlint --format=json -- src/a.js` | `console.log("hi")` + an unused const + `debugger` |
| `eslint.json` | eslint 10.11.0 | `eslint --format=json --no-error-on-unmatched-pattern -- src/a.js` | the same JS, with `no-console: error` and `no-debugger: warn` |

## Why these are recordings

ruff has no npm distribution — there is no `@astral-sh/ruff` package — so it cannot be a
devDependency of this workspace, and eslint is the slow one that rulecast keeps off the edit hook
anyway. oxlint *is* a devDependency and runs for real in `test/detectors/linter/detector.test.ts`.

`test/detectors/linter/live.test.ts`, with `RULECAST_LINTERS=1`, runs whichever of the three real
binaries the machine has and checks these recordings still describe them. Re-record from there
when a tool's output changes.
