# Loop safety

When an agent's goal is "the tests pass", the cheapest way there is often to make the tests or the checker say yes: skip the red test, silence the type error, lower the coverage bar, or edit the CI job that runs it all. The run then reports success and nothing was fixed.

These rules catch those shortcuts as they are written. They flag only what the change adds: a skip or a `noqa` that was already in the file is left alone. The deleted-assertion rules work the other way round: they count a test file's assertions and flag the file when it has fewer than before. While someone is watching they are warnings. In unattended mode (set `RULECAST_MODE=unattended` or `mode: unattended` for `/goal`, `claude -p` and scheduled runs; on by itself in CI) they are errors, so the run cannot stop with them in place, and edits to the loop's own configuration are refused before they are written.

## Skipped and focused tests

Flagged in test files:

- Python (`test*.py`, `*_test.py`, `conftest.py` and anything under `tests/`, so Django's `tests.py` too): `@pytest.mark.skip`, `skipif` and `xfail`, `pytest.skip()` and `pytest.xfail()`, `pytestmark = pytest.mark.skip`, `@unittest.skip`, `skipIf`, `skipUnless` and `expectedFailure`, `self.skipTest()` and `raise unittest.SkipTest`.
- JavaScript and TypeScript (Jest, Vitest, Mocha, Playwright, Cypress): `.skip`, `.only`, `.todo`, `.fixme`, `.skipIf` and `.runIf`, and the expected-failure markers `.failing` (Jest), `.fails` (Vitest) and `.fail` (Playwright), on `describe`, `it`, `test`, `suite`, `context`, `specify` and `bench` (also `test.describe.skip` and `it.concurrent.only`); Mocha's `this.skip()`; and `xit`, `xdescribe`, `xtest`, `fit`, `fdescribe` and `ftest` when called with a test name, so a helper called `fit(points)` is not flagged.

A failing test is information about the code. Skipping it, or marking it as expected to fail, throws that information away and keeps the run green. `.only` is the same shortcut from the other side: the runner then runs the focused tests and silently skips every other one.

`pytest.importorskip` is not flagged. It is the standard guard for an optional dependency, not a way to hide a failure.

## Deleted assertions

Flagged: a test file (the same files as for skipped tests) with fewer assertions than it had before the change.

- Python: `assert` statements, method calls named `assert`, `assert_*` or `assert` and a capital letter (unittest's `self.assertEqual()`, mock's `assert_called_once_with()`, but not `assertions()`), and `pytest.raises`, `pytest.warns`, `pytest.deprecated_call` and `pytest.fail`.
- JavaScript and TypeScript: `expect()` (also with a type argument, `expect<T>()`, and `expect.soft()` and `expect.poll()`), `assert()` and `assert.*()`.

The finding is one per file, on the first line the change touched, and says how many assertions went: `1 of 3 removed`. Deleting one more is the same finding, not a new one, so an unattended run is not blocked afresh for each assertion it deletes. A commented-out assertion counts as removed. Adding, moving or rewriting assertions is not flagged as long as the count does not drop. The count is compared when the agent stops, not after each edit, so an assertion cut in one edit and pasted in the next is not flagged.

Combining assertions lowers the count too: three asserts folded into one parametrized test, or several `expect`s into one `toEqual`, are flagged. If that is what you meant to do, keep it and say so in your report.

Deleting the assertion that fails makes the test pass and checks nothing. If an assertion is wrong, leave it and report it (below).

The count needs something to compare with. In an agent session that is the file as the agent found it, even when the agent first changed it with its shell and only then read it. With `rulecast run --from-ref`, it is the merge base; in a staged run (the pre-commit hook), it is `HEAD`. `rulecast run --files` and `--all-files` have no baseline, so these rules report nothing there.

## Checker suppressions

Flagged in Python, JavaScript and TypeScript files:

- Python: `# noqa` (in any case, as flake8 and ruff read it: `# NOQA` too), `# type: ignore`, `# pyright: ignore`, `# mypy: ignore-errors`, `# pylint: disable`, `# ruff: noqa`, `# flake8: noqa`, `# pyre-ignore`, `# nosec`, `# nosemgrep`, `# pragma: no cover` (also `PRAGMA: NO COVER`, as coverage.py reads it).
- JavaScript and TypeScript: `eslint-disable` (all forms), `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `oxlint-disable`, `deno-lint-ignore`, and the `istanbul`, `c8` and `v8` coverage ignores.

Coverage pragmas count: they silence the coverage checker the way `noqa` silences the linter.

Fix what the checker reports. A suppression the code really needs is the developer's decision, made with them in the loop. `# fmt: off` and `prettier-ignore` are not flagged, because they are formatters, not checkers.

## Checker configuration

Flagged: an edited line in a checker's configuration that turns a check off or loosens it.

- mypy (`pyproject.toml`, `setup.cfg`, `mypy.ini`, `.mypy.ini`): `ignore_missing_imports` set to true, `ignore_errors` set to true under a mypy section, `disable_error_code`, `follow_imports = skip` or `silent`, `allow_untyped_globals`, `allow_redefinition`, `implicit_optional` or `implicit_reexport` set to true, and a `disallow_*`, `warn_*`, `strict*` or `check_untyped_defs` flag set to false. Per module (`[[tool.mypy.overrides]]`, `[mypy-module.*]`) too.
- ruff and flake8 (`pyproject.toml`, `ruff.toml`, `.ruff.toml`, `setup.cfg`, `tox.ini`, `.flake8`): `ignore`, `extend-ignore` and `per-file-ignores`, including an entry added inside an existing list or table.
- pylint (`pyproject.toml`, `setup.cfg`, `.pylintrc`, `pylintrc`): `disable`, including an entry added inside an existing list.
- pyright (`pyproject.toml`, `pyrightconfig.json`): `typeCheckingMode` set to `off`, `basic` or `standard`, and a `report*` setting set to `false`, `none`, `warning` or `information`.
- pytest (`pyproject.toml`, `setup.cfg`, `tox.ini`, `pytest.ini`): `--deselect`, `-k`, `--ignore` and `--ignore-glob`, and `-p no:` for a plugin that checks something: `warnings`, `doctest`, `cov`, `randomly`, `timeout`, `mypy`, `ruff`, `flake8`, `pylint`, `typeguard` and `beartype`. Other plugins, such as `-p no:cacheprovider`, are not flagged.
- ESLint (`.eslintrc*`, `eslint.config.*`, `package.json`): a rule set to `"off"` or `0`. A rule is a key with a `-` or a `/` in it, or one of the core rules `eqeqeq`, `curly`, `camelcase`, `complexity`, `radix`, `semi`, `quotes`, `indent`, `yoda` and `strict`.
- Biome (`biome.json`, `biome.jsonc`): a rule (`no*` or `use*`) set to `"off"`, `"recommended": false`, and `"enabled": false` inside `"linter"`. `"enabled": false` elsewhere, such as under `"vcs"` or `"formatter"`, is not flagged.
- TypeScript (`tsconfig*.json`, `jsconfig.json`): `strict`, `noImplicitAny` and the other `strict*`, `noImplicit*`, `noUnused*` and `noUnchecked*` checks set to `false`.

This is the `noqa` moved out of the code and into the config: the checker stops reporting the problem, and the problem is still there. A `[[tool.mypy.overrides]] ignore_missing_imports = true` for one module is what a real agent wrote when `mypy --strict` stood between it and a green run.

A commented-out line is not flagged: `#` and `;` comments in Python configuration, and lines starting with `//`, `#` or `*` in JavaScript configuration.

`"skipLibCheck": true` is not flagged. It skips checking `.d.ts` files of dependencies, is in nearly every project template, and does not hide errors in the project's own code.

Like the threshold rule, this one sees the file as it is now, not what the line said before. It cannot tell a check that was loosened from one that was moved, or set back to how it was. Some keys, such as `typeCheckingMode` or an `ignore` list, can be changed in either direction, and the change is flagged either way. A change that is right, or that the task asked for, is fine: keep it and say in your report what the setting was and what it is now.

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

- For one line, add `# rulecast-ignore: loop-safety/<rule> <reason>` (or `//` in JavaScript and TypeScript). Every new ignore is reported to the developer at the end of the session. In unattended mode an ignore does not silence a finding on a line changed during the run, so this is for a developer, in an attended session or by hand.
- For a whole rule, set `enabled: false` on its entry in `.rulecast-config.yaml`. For some files only, set `exclude` on the entry to a regex for them.
- For the `no-deleted-assertions-*` rules, use `enabled: false` or an `exclude` on the entry. Their finding is a count for the whole file, not a line, and a `rulecast-ignore` comment does not silence it.
- For `protected-loop-config`, use `enabled: false` or an `exclude` on its entry, not an ignore comment. It is a path rule: its finding is the whole file, so an ignore on the file's first line silences the rule for that whole file, for good, and a JSON file such as `.claude/settings.json` cannot hold a comment at all.
- `@ts-expect-error` in a type test (a `*.test-d.ts` file, or a test that checks a call does not compile) is the assertion, not a suppression, and is still flagged. Exclude those files on the `no-new-suppressions` entry, for example `exclude: '\.test-d\.tsx?$'`.
- To keep a rule a warning in unattended mode, set `escalate: false` on its entry.
- To fail CI or a git hook on these, set `severity: error` on the entry. `rulecast run` always runs rules as written, so they are warnings there by default.

## Not covered

- **Deleted and renamed test files.** A file that is gone has no content to count. Deleting a whole test file is not flagged, and nor is renaming one (`git mv`) and deleting assertions in it: the new path has no baseline.
- **Assertions removed and replaced.** The rule counts, so deleting one assertion and adding an unrelated one leaves the count where it was.
- **Changed expected values and trivial assertions**, such as `== 3` becoming `== 4`, or `assert True`.
- **Assertions outside the listed forms**, such as chai's `should`, node:test's `t.equal()` or a project's own assertion helpers.
- **Other weakening in config**: an ESLint rule turned from `"error"` to `"warn"`, an ESLint core rule turned off whose name has no `-` or `/` and is not one of those listed above, `exclude` and `extend-exclude` lists that take files away from a checker, `ignorePatterns` and `.eslintignore`, and coverage `omit` lists.
- **Markers inside strings.** `"# noqa"` in a string literal is flagged. Only lines the change touched are checked, which keeps this rare.
- **Aliased skips**, such as `from unittest import skip` followed by a bare `@skip`.
- **Skips written as options or on the test context**: node:test's `test('x', { skip: true })` and `{ todo: true }`, and `t.skip()` or `t.todo()` inside a test. Also Vitest's `ctx.skip()`.
- **Deleting a protected file.** A path rule sees only files that exist.
