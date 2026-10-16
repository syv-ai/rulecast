# Loop safety

When an agent's goal is "the tests pass", the cheapest way there is often to make the tests or the checker say yes: skip the red test, silence the type error, lower the coverage bar, or edit the CI job that runs it all. The run then reports success and nothing was fixed.

These rules catch those shortcuts as they are written. They flag only what the change adds: a skip or a `noqa` that was already in the file is left alone. While someone is watching they are warnings. In unattended mode (a goal loop, `claude -p`, a scheduled task, CI) they are errors, so the run cannot stop with them in place, and edits to the loop's own configuration are refused before they are written.

## Skipped and focused tests

Flagged in test files:

- Python: `@pytest.mark.skip`, `skipif` and `xfail`, `pytest.skip()` and `pytest.xfail()`, `pytestmark = pytest.mark.skip`, `@unittest.skip`, `skipIf`, `skipUnless` and `expectedFailure`, `self.skipTest()` and `raise unittest.SkipTest`.
- JavaScript and TypeScript (Jest, Vitest, Mocha, Playwright, Cypress): `.skip`, `.only`, `.todo`, `.fixme` and `.skipIf` on `describe`, `it`, `test`, `suite`, `context`, `specify` and `bench` (also `test.describe.skip` and `it.concurrent.only`), and `xit`, `xdescribe`, `xtest`, `fit`, `fdescribe` and `ftest`.

A failing test is information about the code. Skipping it, or marking it as expected to fail, throws that information away and keeps the run green. `.only` is the same shortcut from the other side: the runner then runs the focused tests and silently skips every other one.

`pytest.importorskip` is not flagged. It is the standard guard for an optional dependency, not a way to hide a failure.

## Checker suppressions

Flagged in Python, JavaScript and TypeScript files:

- Python: `# noqa`, `# type: ignore`, `# pyright: ignore`, `# mypy: ignore-errors`, `# pylint: disable`, `# ruff: noqa`, `# pyre-ignore`, `# nosec`, `# nosemgrep`, `# pragma: no cover`.
- JavaScript and TypeScript: `eslint-disable` (all forms), `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `oxlint-disable`, `deno-lint-ignore`, and the `istanbul`, `c8` and `v8` coverage ignores.

Coverage pragmas count: they silence the coverage checker the way `noqa` silences the linter.

Fix what the checker reports. A suppression the code really needs is the developer's decision, made with them in the loop. `# fmt: off` and `prettier-ignore` are not flagged, because they are formatters, not checkers.

## Quality thresholds

Flagged: an edited line that sets `fail_under`, `--cov-fail-under`, `--fail-under`, `coverageThreshold`, a `thresholds:` block, a `lines`/`branches`/`functions`/`statements` percentage, or `--max-warnings`. The files checked are `pyproject.toml`, `setup.cfg`, `tox.ini`, `.coveragerc`, `pytest.ini`, `noxfile.py`, `Makefile`, `package.json`, Jest, Vitest and Vite config, `.nycrc`, `.c8rc` and `codecov.yml`.

A threshold is the bar the project agreed on. Lowering it to make a run pass moves the bar instead of clearing it.

The rule cannot tell raising from lowering: it sees the file as it is now, not what the line said before. So raising a threshold is flagged too. That change is fine. Leave it, and say in your report that you raised the threshold and to what.

## Loop configuration

Flagged, and refused in unattended mode: CI workflows (`.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml`, `.buildkite/`, `Jenkinsfile`), git hooks (`lefthook.yml`, `.lefthook/`, `.husky/`, `.pre-commit-config.yaml`), `.rulecast-config.yaml`, and `.claude/settings.json` and `settings.local.json`, which hold the hooks rulecast runs from.

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

- For one line, add `# rulecast-ignore: loop-safety/<rule> <reason>` (or `//` in JavaScript and TypeScript). Every new ignore is reported to the developer at the end of the session.
- For a whole rule, set `enabled: false` on its entry in `.rulecast-config.yaml`.
- To keep a rule a warning in unattended mode, set `escalate: false` on its entry.
- To fail CI or a git hook on these, set `severity: error` on the entry. `rulecast run` always runs rules as written, so they are warnings there by default.

## Not covered

- **Deleted assertions and deleted test files.** A deletion leaves nothing to match. A rule for removed assertions is planned; it needs rulecast to compare a file with its baseline, which detectors cannot do today.
- **Changed expected values and trivial assertions**, such as `== 3` becoming `== 4`, or `assert True`.
- **Other weakening in config**: new ruff `ignore` or `per-file-ignores` entries, an eslint rule set to `"off"`, `"strict": false` in `tsconfig.json`, a mypy `ignore_missing_imports` or `ignore_errors` override, and pytest `addopts` with `--deselect`, `-k` or `--ignore`.
- **Markers inside strings.** `"# noqa"` in a string literal is flagged. Only lines the change touched are checked, which keeps this rare.
- **Aliased skips**, such as `from unittest import skip` followed by a bare `@skip`.
- **Deleting a protected file.** A path rule sees only files that exist.
