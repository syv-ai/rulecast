# Loop safety

When an agent's goal is "the tests pass", the cheapest way there is often to make the tests or the checker say yes: skip the red test, silence the type error, lower the coverage bar, or edit the CI job that runs it all. The run then reports success and nothing was fixed.

These rules catch those shortcuts as they are written. They flag only what the change adds: a skip or a `noqa` that was already in the file is left alone. While someone is watching they are warnings. In unattended mode (set `RULECAST_MODE=unattended` or `mode: unattended` for `/goal`, `claude -p` and scheduled runs; on by itself in CI) they are errors, so the run cannot stop with them in place, and edits to the loop's own configuration are refused before they are written.

## Skipped and focused tests

Flagged in test files:

- Python (`test*.py`, `*_test.py`, `conftest.py` and anything under `tests/`, so Django's `tests.py` too): `@pytest.mark.skip`, `skipif` and `xfail`, `pytest.skip()` and `pytest.xfail()`, `pytestmark = pytest.mark.skip`, `@unittest.skip`, `skipIf`, `skipUnless` and `expectedFailure`, `self.skipTest()` and `raise unittest.SkipTest`.
- JavaScript and TypeScript (Jest, Vitest, Mocha, Playwright, Cypress): `.skip`, `.only`, `.todo`, `.fixme`, `.skipIf` and `.runIf`, and the expected-failure markers `.failing` (Jest), `.fails` (Vitest) and `.fail` (Playwright), on `describe`, `it`, `test`, `suite`, `context`, `specify` and `bench` (also `test.describe.skip` and `it.concurrent.only`); Mocha's `this.skip()`; and `xit`, `xdescribe`, `xtest`, `fit`, `fdescribe` and `ftest` when called with a test name, so a helper called `fit(points)` is not flagged.

A failing test is information about the code. Skipping it, or marking it as expected to fail, throws that information away and keeps the run green. `.only` is the same shortcut from the other side: the runner then runs the focused tests and silently skips every other one.

`pytest.importorskip` is not flagged. It is the standard guard for an optional dependency, not a way to hide a failure.

## Checker suppressions

Flagged in Python, JavaScript and TypeScript files:

- Python: `# noqa` (in any case, as flake8 and ruff read it: `# NOQA` too), `# type: ignore`, `# pyright: ignore`, `# mypy: ignore-errors`, `# pylint: disable`, `# ruff: noqa`, `# flake8: noqa`, `# pyre-ignore`, `# nosec`, `# nosemgrep`, `# pragma: no cover` (also `PRAGMA: NO COVER`, as coverage.py reads it).
- JavaScript and TypeScript: `eslint-disable` (all forms), `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `oxlint-disable`, `deno-lint-ignore`, and the `istanbul`, `c8` and `v8` coverage ignores.

Coverage pragmas count: they silence the coverage checker the way `noqa` silences the linter.

Fix what the checker reports. A suppression the code really needs is the developer's decision, made with them in the loop. `# fmt: off` and `prettier-ignore` are not flagged, because they are formatters, not checkers.

## Quality thresholds

Flagged: an edited line that sets `fail_under`, `--cov-fail-under`, `--fail-under`, `coverageThreshold`, a `thresholds:` block, a `lines`/`branches`/`functions`/`statements` percentage or c8 and nyc's `--lines`, `--branches`, `--functions` and `--statements` flags, codecov's `target: 80%` and `threshold: 1%`, or `--max-warnings`. The files checked are `pyproject.toml`, `setup.cfg`, `tox.ini`, `.coveragerc`, `pytest.ini`, `noxfile.py`, `Makefile`, `package.json`, Jest, Vitest and Vite config, `.nycrc`, `.c8rc` and `codecov.yml` (or `.codecov.yml`).

One pattern covers all of these files, so a `target:` or `threshold:` set to a percentage is flagged in any of them, not only in `codecov.yml`. Outside codecov a percentage there is rare.

A threshold is the bar the project agreed on. Lowering it to make a run pass moves the bar instead of clearing it.

The rule cannot tell raising from lowering: it sees the file as it is now, not what the line said before. So raising a threshold is flagged too, and so is a change the task asked for. Those changes are fine: keep them, and say in your report what the threshold was and what it is now. Do not undo a correct change to make the finding go away. In unattended mode the finding still holds the stop, at most twice, and is then reported instead. That is the cost of catching every lowering.

## Loop configuration

Flagged, and refused in unattended mode: CI workflows and the actions they call (`.github/workflows/`, `.github/actions/`, `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml`, `.buildkite/`, `Jenkinsfile`), git hooks (`lefthook.yml`, `.lefthook.yml` and lefthook's TOML and JSON config, `.lefthook/`, `.husky/`, `.pre-commit-config.yaml`), `.rulecast-config.yaml`, and `.claude/settings.json` and `settings.local.json`, which hold the hooks rulecast runs from.

These files decide what "done" means for the run: which tests run, which checks gate a merge, and which rules hold. A run that changes them can make any check pass, so the run being judged must not change them. If one of them is wrong for the task, say what and why in your report.

## When a test is wrong

Fix the code. That is almost always the answer.

Sometimes the test, the checker or the threshold really is wrong: it tests behaviour the task changes on purpose, it was already failing before you started, or it needs a service or a credential that is not there. Even then, do not skip it, silence it, delete it or loosen it. Leave it failing, and stop and report:

- which test or check it is, and what it asserts,
- why you think it is wrong,
- what you ran, and what it printed.

The developer then decides, with the evidence in front of them. A test removed by the agent that was supposed to pass it proves nothing, even when the agent was right.

In an unattended run there is nobody to ask. Write the report in the run's decisions file if it keeps one, otherwise in your final report, and carry on with the rest of the task.

## Changing these on purpose

These rules are about who makes the change, not about the change itself. A developer who means to skip a test, add a suppression, change a threshold or edit CI does it in an attended session, where the rules are warnings, or by hand.

- For one line, add `# rulecast-ignore: loop-safety/<rule> <reason>` (or `//` in JavaScript and TypeScript). Every new ignore is reported to the developer at the end of the session. In unattended mode an ignore added during the run silences nothing, so this is for a developer, in an attended session or by hand.
- For a whole rule, set `enabled: false` on its entry in `.rulecast-config.yaml`. For some files only, set `exclude` on the entry to a regex for them.
- For `protected-loop-config`, use `enabled: false` or an `exclude` on its entry, not an ignore comment. It is a path rule: its finding is the whole file, so an ignore on the file's first line silences the rule for that whole file, for good, and a JSON file such as `.claude/settings.json` cannot hold a comment at all.
- `@ts-expect-error` in a type test (a `*.test-d.ts` file, or a test that checks a call does not compile) is the assertion, not a suppression, and is still flagged. Exclude those files on the `no-new-suppressions` entry, for example `exclude: '\.test-d\.tsx?$'`.
- To keep a rule a warning in unattended mode, set `escalate: false` on its entry.
- To fail CI or a git hook on these, set `severity: error` on the entry. `rulecast run` always runs rules as written, so they are warnings there by default.

## Not covered

- **Deleted assertions and deleted test files.** A deletion leaves nothing to match. A rule for removed assertions is planned; it needs rulecast to compare a file with its baseline, which detectors cannot do today.
- **Changed expected values and trivial assertions**, such as `== 3` becoming `== 4`, or `assert True`.
- **Other weakening in config**: new ruff `ignore` or `per-file-ignores` entries, an eslint rule set to `"off"`, `"strict": false` in `tsconfig.json`, a mypy `ignore_missing_imports` or `ignore_errors` override, and pytest `addopts` with `--deselect`, `-k` or `--ignore`.
- **Markers inside strings.** `"# noqa"` in a string literal is flagged. Only lines the change touched are checked, which keeps this rare.
- **Aliased skips**, such as `from unittest import skip` followed by a bare `@skip`.
- **Skips written as options or on the test context**: node:test's `test('x', { skip: true })` and `{ todo: true }`, and `t.skip()` or `t.todo()` inside a test. Also Vitest's `ctx.skip()`.
- **Deleting a protected file.** A path rule sees only files that exist.
