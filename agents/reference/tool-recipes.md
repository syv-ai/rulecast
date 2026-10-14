# Tool recipes

A tested `detect` block for each tool below, for a [`command`](detectors.md#command) or [`hook`](detectors.md#hook) rule. Each one was run on a small project with a seeded problem and reported it (`packages/rulecast/test/detectors/command/live.test.ts`, 2026-10-14). Copy the block into a rule with your own `id`, `files`, `message` and `context`:

```yaml
- id: types/no-type-errors
  name: The code type-checks
  files: \.py$
  detect:
    command:
      run: [ty, check, --output-format, gitlab, "{{files}}"]
      output: gitlab
      exit_codes: { error: [2, 101] }
  message: "{{file}}:{{line}}: {{message}} ({{ruleId}})"
  context: ["@AGENTS.md#types"]
```

Add `rules: [<rule id>, ...]` to any of them to keep only those findings: one rule per convention, each citing its own section, all sharing one run of the tool.

`scope: project` means the tool reads the whole project, so the rule runs at verify only unless you add `stages: [edit, verify]`, and in a staged run only when its files have no unstaged changes. The speed notes say which tools are fast enough for edits.

If the project already runs a tool as a pre-commit or lefthook hook, a [`hook`](#a-hook-the-project-already-runs) rule is less to keep in step: the hook's own arguments and environment apply.

## Python

**ty** (types; 10–20 ms per file, fast enough for edits). Exit 1 is findings; 2 is a bad config and 101 a crash.

```yaml
command:
  run: [ty, check, --output-format, gitlab, "{{files}}"]
  output: gitlab
  exit_codes: { error: [2, 101] }
```

**mypy** (types). Don't add `--show-error-end`: it changes the line shape. `note:` lines are findings with severity `note` and no rule id; `rules:` leaves them out.

```yaml
command:
  run: [mypy, --show-column-numbers, --no-error-summary, "{{files}}"]
  output: { lines: gcc }
  exit_codes: { error: [2] }
```

**pyright** (types). Its text lines are 1-based; its `--outputjson` is 0-based, so use the text. The rule name sometimes sits on a continuation line, which the pattern skips: the message then has no `(reportX)`.

```yaml
command:
  run: [pyright, "{{files}}"]
  output:
    lines:
      pattern: '^\s+(?<file>.+?):(?<line>\d+):(?<col>\d+) - (?<severity>\w+): (?<message>.*)$'
  exit_codes: { error: [2, 3, 4] }
```

**vulture** (dead code; seconds on a large project). Its answer about one file depends on the others, so it runs on the project. Exit 3 is findings.

```yaml
command:
  run: [vulture, "."]
  output: { lines: gcc-nocol }
  scope: project
  exit_codes: { error: [1, 2] }
```

## TypeScript and JavaScript

**tsc** (types). TypeScript 7's native `tsc` checks a medium package in under half a second; older ones take seconds. Passing files while a `tsconfig.json` exists is an error in TypeScript 7, so it runs on the project.

```yaml
command:
  run: [tsc, --noEmit, --pretty, "false"]
  output: { lines: msbuild }
  scope: project
```

**knip** (unused files, exports and dependencies). Rule ids are `knip/files`, `knip/exports`, `knip/dependencies` and so on; an unused file or dependency is a finding on line 1.

```yaml
command:
  run: [knip, --reporter, sarif, --no-progress]
  output: sarif
  scope: project
  exit_codes: { error: [2] }
```

**jscpd** (copy-paste across files). jscpd writes SARIF only to a file, so this reads its `xcode` lines. Its paths are relative to the path it scans, so it scans `.`, and a clone is reported on one of its two files, naming the other in the message. Its defaults (`--min-lines 5`, `--min-tokens 50`) skip small clones; the test lowers them for its tiny fixture.

```yaml
command:
  run: [jscpd, -r, xcode, --no-colors, --ignore, "**/.git/**", "."]
  output: { lines: gcc }
  scope: project
```

## Go

**staticcheck** (bugs, simplifications, unused code; warm cache 0.1 s).

```yaml
command:
  run: [staticcheck, -f, sarif, ./...]
  output: sarif
  scope: project
```

**golangci-lint** (v2). The SARIF rule id is the linter's name (`govet`, `unused`, `staticcheck`), not the check inside it, which is in the message.

```yaml
command:
  run: [golangci-lint, run, --output.sarif.path=stdout, --output.text.path=, --show-stats=false, ./...]
  output: sarif
  scope: project
  exit_codes: { error: [2, 3, 4, 5, 7] }
```

**deadcode** (functions unreachable from `main`). It exits 0 with findings, which is fine: the output is the answer.

```yaml
command:
  run: [deadcode, "."]
  output: { lines: gcc }
  scope: project
```

## Everything else

**semgrep** (patterns from your own rule file; about 2 s to start, so verify only). It exits 0 with findings unless given `--error`; leave it out.

```yaml
command:
  run: [semgrep, --sarif, --metrics, "off", -q, --config, semgrep.yml, "{{files}}"]
  output: sarif
```

**hadolint** (Dockerfiles; 40 ms).

```yaml
command:
  run: [hadolint, -f, sarif, "{{files}}"]
  output: sarif
```

**tflint** (Terraform; 40 ms without plugins). It works on a directory; exit 1 is an error, 2 is findings.

```yaml
command:
  run: [tflint, -f, sarif]
  output: sarif
  scope: project
  exit_codes: { error: [1] }
```

**shellcheck** (shell; 40 ms).

```yaml
command:
  run: [shellcheck, -f, checkstyle, "{{files}}"]
  output: checkstyle
```

**osv-scanner** (known-vulnerable dependencies; needs the network and takes seconds, so verify or CI). Findings are on line 1 of the lockfile; the rule id is the advisory id.

```yaml
command:
  run: [osv-scanner, scan, source, -f, sarif, -L, requirements.txt]
  output: sarif
  scope: project
```

**checkov** (infrastructure as code; about 4 s). checkov writes SARIF only to a file and prints its own report to stdout, so a shell runs it and prints the file instead.

```yaml
command:
  run:
    - sh
    - -c
    - 'd=$(mktemp -d) && checkov --quiet -o sarif --output-file-path "$d" -f "$@" >/dev/null; cat "$d/results_sarif.sarif"; rm -rf "$d"'
    - checkov
    - "{{files}}"
  output: sarif
```

The same trick works for any tool that writes its report to a file: run it under `sh -c` and `cat` the file.

## A hook the project already runs

A pre-commit hook, run by prek or pre-commit with the hook's own `entry`, `args` and environment:

```yaml
hook:
  pre-commit: mypy
  output: { lines: gcc }
```

A lefthook job, its command run with the rule's files in place of `{staged_files}`:

```yaml
hook:
  lefthook: pre-commit/lint
  output: { lines: gcc }
```

A formatter hook (ruff-format, prettier, black) works too: the file is put back, and each file it would change is a finding.
