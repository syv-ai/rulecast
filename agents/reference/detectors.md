# rulecast detectors

A rule's `detect` names one detector and its config. The message template of every match can use `{{file}}`, `{{line}}`, `{{column}}`, `{{text}}` (the matched text) and `{{rule}}`, plus the detector's captures. Any other variable is a `rulecast validate` error.

A detector needs things the project may not have: a linter binary, a parser, an API key. `rulecast doctor` reports what each configured rule needs and whether it is there, so run it after drafting a rule that names a tool.

## `regex`

```yaml
detect:
  regex:
    pattern: 'raise HTTPException\((?<args>[^)]*)\)'
    flags: m
```

- `pattern`: a JavaScript regular expression, searched in the whole file. Quote it with single quotes in YAML so backslashes stay as written.
- `flags`: any of `d`, `i`, `m`, `s`, `u`, `v`, `y`; default none. `g` is always added. Use `m` for `^` and `$` at each line, `s` for `.` across lines.
- `\s` matches a line break. With `m`, `^\s*print\(` matches from an empty line above the `print(` and reports that empty line. Indentation is `[ \t]*`: `^[ \t]*print\(`. `rulecast test` prints what a failing example matched, line breaks included.
- Captures: the pattern's named groups. `(?<args>…)` gives `{{args}}`, an empty string when the group did not take part in the match.
- Position: the line and column where the match starts. A match that spans lines counts as new when any of its lines changed.
- Default stages: `edit`, `verify`.

## `path`

```yaml
detect:
  path: {}
```

- Every file the rule selects is a match at line 1, so the rule's `files` is the whole check. Use it for files that must not be edited at all, such as generated code.
- Captures: none. `{{text}}` is the file path.
- Default stages: `edit`, `verify`.

## `ast-grep`

```yaml
detect:
  ast-grep:
    language: python
    rule:
      pattern: "raise HTTPException($$$ARGS)"
      inside: { kind: function_definition }
```

- `language`: one of `css`, `html`, `javascript`, `python`, `tsx`, `typescript`. Use `tsx` for both `.tsx` and `.jsx`; it also parses plain TypeScript.
- `rule`: an [ast-grep rule object](https://ast-grep.github.io/reference/rule.html) — `pattern`, `kind`, `regex`, `inside`, `has`, `all`, `any`, `not`, and the rest. It is compiled when you run `rulecast validate`, so a rule ast-grep rejects is caught before any agent sees it.
- `constraints` and `utils`: optional, exactly as in ast-grep's own YAML.
- Captures: every metavariable in the config. `$NAME` gives `{{NAME}}` (one node, empty when it did not match); `$$$NAMES` gives `{{NAMES}}` with the matched nodes joined by `, `. A metavariable starting with an underscore (`$_TMP`) matches without capturing.
- Position and `{{text}}`: the matched node's start, and its source.
- Default stages: `edit`, `verify`.

**Matching something that is not a whole statement.** A bare pattern has to parse on its own, which a JSX attribute or a lone argument does not. Give the pattern a context to parse in, and a selector for the node you actually want:

```yaml
rule:
  pattern:
    context: '<div style={{ $$$PROPS }}/>'
    selector: jsx_attribute
```

That matches a `style` attribute on any element — the `<div>` is only there so the snippet parses.

## `command`

Any tool that works as a pre-commit hook works as a `command` rule: rulecast runs it, reads what it prints, and hands each finding to the agent with the rule's message and the doc section it cites. [tool-recipes.md](tool-recipes.md) has a tested rule for ty, mypy, pyright, vulture, tsc, knip, jscpd, staticcheck, golangci-lint, deadcode, semgrep, hadolint, tflint, shellcheck, osv-scanner and checkov.

```yaml
detect:
  command:
    run: [ty, check, --output-format, gitlab, "{{files}}"]
    output: gitlab
    rules: [invalid-assignment]       # optional: only these rule ids
    exit_codes: { error: [2, 101] }   # optional: these codes mean the tool failed
```

- `run`: the command and its arguments, run from the project root. The argument that is exactly `{{files}}` is replaced by the rule's files; if there is no such argument, the files are appended. A rule that selects no files does not run the command at all.
- `output`: how to read what the tool prints. Default `json`.
  - `json`: an array of `{ file, line, endLine?, column?, endColumn?, ruleId?, message?, severity?, text?, ...captures }`.
  - `sarif`: SARIF 2.1.0, `runs[].results[]`. A result with no region is on line 1; one that passed, did not apply or is suppressed is skipped.
  - `checkstyle`: checkstyle XML. The rule id is the last dotted part of `source` (`ShellCheck.SC2164` → `SC2164`).
  - `gitlab`: GitLab code-quality JSON, the only JSON ty prints. `check_name` is the rule id.
  - `rdjson`: reviewdog's diagnostic format, or rdjsonl, one diagnostic per line.
  - `{ lines: gcc }`: `file:line:col: [severity[rule]:] message [(rule)]` — mypy `--show-column-numbers`, ty `--output-format concise`, shellcheck `-f gcc`, staticcheck, golangci-lint, deadcode, tflint `-f compact`. A trailing `(U1000)` or `[SC2115]` is the rule id when it has no spaces and has a letter.
  - `{ lines: gcc-nocol }`: the same without a column — vulture, mypy without columns.
  - `{ lines: msbuild }`: `file(line,col): severity CODE: message` — tsc, dotnet.
  - `{ lines: { pattern: '…' } }`: a JavaScript regular expression matched against each line, with named groups `file`, `line` and `message` (required) and `col`, `endLine`, `endCol`, `rule`, `severity` (optional). Any other named group is a capture. A pattern that does not compile or lacks a required group is a `rulecast validate` error.
  - For every line format, a line that does not match is ignored: tools interleave source excerpts and summaries with their findings. `file` may be absolute or repo-relative.
- `stream`: `stdout` (default), `stderr`, or `both` for a tool that reports on stderr.
- `rules`: keep only findings with these rule ids. Rules with the same `run`, `output`, `stream`, `scope` and `exit_codes` share one run and split its findings, so three semgrep rules scan once.
- `exit_codes`: `{ error: [...] }` names the exit codes that mean the tool failed rather than found something — ty exits 1 on findings and 2 on a bad config, vulture 3 on findings, semgrep 0 either way. A listed code disables the rule with the tool's first lines of stderr. Every other code is read as findings-or-clean: the output is the answer.
- `scope`: `files` (default) gives the tool the rule's files. `project` runs it without files (`{{files}}` resolves to nothing) and keeps only the findings in the rule's files. Use it for a type checker, a dead-code tool or a duplication finder, whose answer about a file depends on the rest of the project.
- `captures`: extra names your message uses, each a string field the tool emits on **every** finding (JSON fields, SARIF `properties`, a pattern's named groups). A missing one disables the rule, so the mistake is visible rather than silently blank. A capture may not shadow `file`, `line`, `column`, `text` or `rule`.
- Every finding carries `{{message}}`, `{{ruleId}}` and `{{severity}}` (the tool's own word: `error`, `major`, `note`; empty when it gave none). `{{text}}` is the source at the finding's range, unless a JSON result gives its own `text`.
- Output that cannot be parsed disables the rule.
- In a staged run (`rulecast run` with no file flags) or with `--to-ref`, a `files` rule is handed a copy of each file under a scratch directory (`.rulecast-staged-XXXX/<path>`), because the content it must judge is the index or a commit, not the file on disk. Findings are mapped back to the real path. A script that decides by path should match the end of the path, not its start. A `project` rule needs the real project, so it runs on the working tree when its files there match the index (or the commit), and is skipped with a warning naming the files when they don't. rulecast never stashes to make them match.
- Default stages: `edit`, `verify`; **`verify` only with `scope: project`**, since a whole-project run is usually too slow for an edit. Write `stages: [edit, verify]` if your tool is fast enough (ty, hadolint, shellcheck and tflint take 15–50 ms per file).

## `hook`

```yaml
detect:
  hook:
    pre-commit: mypy                 # a hook id in .pre-commit-config.yaml
    # lefthook: pre-commit/typecheck # or a lefthook job: <hook>/<job>
    output: { lines: gcc }           # default
```

Runs a hook the project already declares, so the agent sees the same thing a commit would show it, with the rule's message and doc section.

- `pre-commit`: a hook id (or alias) in `.pre-commit-config.yaml`. rulecast runs `prek run <id> --files <files>` when prek is installed, else `pre-commit run …`, from the project's `node_modules/.bin` or `PATH`. That mode never stashes. A hook whose `stages` leave out `pre-commit` is run at its first stage. `rulecast validate` names an id the config does not declare.
- `lefthook`: `<hook>/<job>` in lefthook's merged config (`lefthook dump`), including jobs inside groups and lefthook 1's `commands:`. rulecast runs the job's `run` command itself, from the job's `root`, with the rule's files in place of `{staged_files}`, `{files}`, `{all_files}` and `{push_files}`. It does not call `lefthook run`, which can install git hooks. The job's `glob` is not applied: the rule's `files` decide.
- `output`, `rules`, `exit_codes`, `captures`: as for `command`. The runner's own framing (pre-commit's status line and `- hook id` block, prek's indent) is removed before the output is read.
- A hook that changes a file — a formatter, a fixer — has the file put back as it was, and each changed file is a finding: `{{message}}` is "<hook> would change this file". rulecast never rewrites an agent's file behind its back. Only the rule's files are compared.
- A hook that fails and prints nothing the `output` format reads is one finding on the rule's first file, carrying the hook's first lines of output, so the agent still hears that it failed and why.
- A runner that never ran the hook (an unknown id, an environment it could not install) disables the rule with what it said.
- `rulecast doctor` reports the runner it would use and every hook id or job it cannot find.
- husky is not supported: its hooks are shell scripts with nothing structured to read. Use `command` with the script's command.
- Like a `project` command rule, a hook rule runs on the working tree in a staged run when its files match the index, and is skipped with a warning when they don't.
- Default stages: **`verify` only.** Hooks are written for a commit, not a keystroke. Write `stages: [edit, verify]` if yours is fast.

## `linter`

```yaml
detect:
  linter: { tool: ruff, rules: [T201] }
```

- `tool`: `ruff`, `oxlint`, `eslint` or `gitleaks`. rulecast looks for it in the project's `node_modules/.bin`, then — for `ruff` in a project with a `pyproject.toml` — as `uv run ruff`, then on `PATH`. A tool that is not installed disables its own rules and nothing else.
- `rules`: the linter's own rule ids to report. rulecast turns them on for its run (ruff `--extend-select`, oxlint `-D`, eslint `--rule`), so they fire even where the project's config leaves them off; the rule's settings, such as a maximum, still come from that config. Inline suppressions (`# noqa`, `// eslint-disable-next-line`, `// oxlint-disable-next-line`) still hold, and so do ruff's `per-file-ignores` and oxlint's `overrides`. eslint's `--rule` wins over its config's per-file settings too. A plugin rule needs its plugin loaded by the project's eslint config, and eslint needs a config file to run at all.
- `gitleaks` finds hard-coded secrets: credential formats it knows (`aws-access-token`, `github-pat`, …) and high-entropy strings next to key-like names (`generic-api-key`). `rules` are its rule ids; without `rules`, every rule in its config runs. The project's `.gitleaks.toml`, `.gitleaksignore` and `gitleaks:allow` comments apply. `{{text}}` is always `[redacted]`, so a finding never repeats the secret into the agent's context, a log or SARIF. It is a Go binary, not an npm package: install it from your package manager (`brew install gitleaks`) or its releases.
- Leave `rules` out to take every finding the tool reports under the project's own config. Such rules get a run of their own, so the rules other rules turn on never reach them.
- One process per tool per event, over every file its rules select together, with the findings handed back to the rules that asked for them. Ten `ruff` rules cost one `ruff` run.
- Captures: `{{ruleId}}` and `{{message}}`. `{{text}}` is the source the linter pointed at.
- In a staged run or with `--to-ref`, `ruff` and `eslint` are handed each file's staged content on stdin under its real path, one process per file, so path-keyed configuration (`per-file-ignores`, eslint `files:` globs) applies as usual. `oxlint` has no stdin mode and gets a scratch copy, which such configuration does not match.
- Default stages: `edit`, `verify` — **except `eslint`, which is `verify` only**, because it is slow enough to be felt on every edit. Write `stages: [edit, verify]` if you want it anyway.

## `llm`

```yaml
detect:
  llm:
    model: haiku
    question: >
      Does this route do more than parse input, call a service,
      and return the result? Report each offending line.
    grounding: true
```

- `model`: **required, no default.** Either a rulecast alias — `haiku`, `sonnet`, `opus`, `fable` — which every provider maps to its own name, or the exact model name your provider uses (`claude-haiku-4-5-20251001`, `gpt-5-mini`, `qwen3-coder:30b`), which is passed through untouched. There is no project-wide default on purpose: the cost of a rule is chosen by whoever writes it.
- `question`: what the model is asked about the file. Ask for specific lines — "Report each offending line" — or you get an essay instead of findings.
- `grounding`: defaults to `true`. Sends the rule's `context` references with the question, whatever their delivery mode, so the model judges against your conventions rather than its own taste. Set it to `false` when the question stands alone.
- One call per file **and model**, covering every llm rule that selected that file. Three llm rules on one file all using `haiku` cost one call; a fourth using `sonnet` costs a second.
- Files with no changed lines are not sent at all. When there is a change set the changed lines are marked and the model is told to report only those; with no change set it judges the whole file.
- Answers are cached on the file's content, the change set, the provider, the model and the rules' questions and grounding. Re-running a verify with nothing changed makes no calls.
- At most `llm.max_files_per_verify` files per verify (default 10), most recently edited first. The rest are named in a warning.
- Captures: `{{reason}}`, the model's explanation. `{{text}}` is the line from the file, not the model's quote of it.
- Default stages: **`verify` only.** A model call takes seconds; it has no business in an edit hook. Write `stages: [edit, verify]` if you want it anyway.
- Providers are configured once for the project, in `llm.provider`:

  | Provider | Needs | `llm.base_url` |
  |---|---|---|
  | `claude-code` (default) | `claude` on `PATH`, signed in. No API key | ignored |
  | `opencode` | `opencode` on `PATH` | ignored |
  | `anthropic` | `llm.api_key_env` (default `ANTHROPIC_API_KEY`) | the origin, e.g. `https://api.anthropic.com`; rulecast appends `/v1/messages` |
  | `openai-compatible` | `llm.api_key_env` | includes the version prefix, e.g. `http://localhost:11434/v1` for Ollama; rulecast appends `/chat/completions` |

  Each `base_url` follows its own ecosystem's SDK convention, so a URL copied from your provider's docs works as written. **Azure OpenAI is not supported in 0.1**: it needs a per-deployment path with an `api-version` query string and an `api-key` header, which no `base_url` can express.

**An llm rule sends the file's contents and the rule's grounding to the configured provider, and costs money for every file that is not already cached.** So `rulecast run` with no file flags, the pre-commit check, skips llm rules unless given `--llm`, and says so in one line. `--all-files`, `--from-ref` and the agent's stop run them; `--no-llm` skips them anywhere. It is the right answer only when no pattern can express the convention. Reach for `path`, `regex` and `ast-grep` first: they are free, instant and exact. If you cannot write the check mechanically but the convention still matters, a `stages: [touch]` rule that delivers the section is usually better than asking a model — it puts the convention in front of the agent before the code is written, instead of judging it afterwards.
