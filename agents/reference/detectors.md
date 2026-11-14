# rulecast detectors

A rule's `detect` names one detector and its config. The message template of every match can use `{{file}}`, `{{line}}`, `{{column}}`, `{{text}}` (the matched text) and `{{rule}}`, plus the detector's captures. Any other variable is a `rulecast validate` error.

A detector needs things the project may not have: a linter binary, a parser, an API key. `rulecast doctor` reports what each configured rule needs and whether it is there, so run it after drafting a rule that names a tool.

## `linter`

```yaml
detect:
  linter: { tool: ruff, rules: [T201] }
```

- `tool`: `ruff`, `oxlint`, `eslint`, `biome` or `gitleaks`. Each file is linted from the nearest directory above it, up to the repository's top, that holds the tool's config (`pyproject.toml`, `ruff.toml` or `.ruff.toml` for ruff, `eslint.config.*`, `.oxlintrc.json`, `biome.json` or `biome.jsonc`, `.gitleaks.toml`), or from the project root when there is none. rulecast looks for the tool in `node_modules/.bin` from that directory up to the repository's top. For `ruff` it then looks in `.venv/bin` and `venv/bin` over the same directories, then uses `uv run ruff` when the directory has a `pyproject.toml` and a `uv.lock` sits there or above it. Last comes `PATH`, which also covers an activated virtualenv. Without a `uv.lock`, rulecast does not use `uv`, which would create one and a `.venv` in the project. A tool that is not installed disables its own rules and nothing else.
- `rules`: the linter's own rule ids to report. For ruff they are selectors, as in ruff's `select`: `B` takes every flake8-bugbear finding (B006, not BLE001), `E5` takes E501, `PL` takes pylint's PLC, PLE, PLR and PLW, and `ALL` takes everything. A selector ruff has renamed takes what its new name does: `TCH` takes TC001, `TRIO` takes ASYNC100. rulecast turns them on for its run (ruff `--extend-select`, oxlint `-D`, eslint `--rule`, biome `--only`), so they fire even where the project's config leaves them off; the rule's settings, such as a maximum, still come from that config. Inline suppressions (`# noqa`, `// eslint-disable-next-line`, `// oxlint-disable-next-line`) still hold, and so do ruff's `per-file-ignores` and oxlint's `overrides`. eslint's `--rule` wins over its config's per-file settings too. A plugin rule needs its plugin loaded by the project's eslint config, and eslint needs a config file to run at all.
- `biome`: rule ids as `biome.json` writes them, `suspicious/noDebugger`; a bare `noDebugger` is refused, since findings carry the group. rulecast runs `biome lint --reporter=rdjson`, the reviewdog format, which Biome keeps stable where its own JSON reporter is experimental. Biome has no stdin mode that reports findings, so a file that is not on disk is linted as a scratch copy. `init` can't list which rules its config makes errors, so it offers Biome without a count.
- `gitleaks` finds hard-coded secrets: credential formats it knows (`aws-access-token`, `github-pat`, …) and high-entropy strings next to key-like names (`generic-api-key`). `rules` are its rule ids; without `rules`, every rule in its config runs. The project's `.gitleaks.toml`, `.gitleaksignore` and `gitleaks:allow` comments apply. `{{text}}` is always `[redacted]`, so a finding never repeats the secret into the agent's context, a log or SARIF. It is a Go binary, not an npm package: install it from your package manager (`brew install gitleaks`) or its releases.
- Leave `rules` out to take what the project's own config makes an error: ESLint level 2 (`error`), oxlint `error` or `deny`, Biome's `error` severity, every rule Ruff selects (Ruff has no levels), and every gitleaks finding. Warnings are not delivered: to have one delivered, make it an error in the linter's config, or name it in `rules`. Such rules get a run of their own, so the rules other rules turn on never reach them. A file the project's ESLint config does not match gives no finding.
- Every finding carries the tool's page for its lint rule, where the tool's output gives one (ESLint, Ruff, oxlint and Biome do; gitleaks does not). It is shown under the finding as `upstream docs: <url>`, unless the rule's `context_by_rule` maps a section for that lint rule (rule-format.md). ESLint is run with `--format=json-with-metadata`, which carries the url in the same process.
- One process per tool and directory per event, over every file its rules select together, with the findings handed back to the rules that asked for them. Ten `ruff` rules cost one `ruff` run.
- Captures: `{{ruleId}}` and `{{message}}`. `{{text}}` is the source the linter pointed at.
- In a staged run or with `--to-ref`, the tool is handed the content to judge, not the file on disk: see [In staged and `--to-ref` runs](#in-staged-and---to-ref-runs).
- Default stages: `edit`, `verify` — **except `eslint`, which is `verify` only**. Its process start and config load take about 175 ms on a trivial config and seconds with type-aware plugins, and on edit a detector past the 350 ms edit deadline is dropped, so an ESLint rule on edit would usually make the edit wait and deliver nothing. Its findings reach the agent when it stops, in the same session. Write `stages: [edit, verify]` if your ESLint is fast.

## `command`

Any tool that works as a pre-commit hook works as a `command` rule: rulecast runs it, reads what it prints, and hands each finding to the agent with the rule's message and the doc section it cites. [tool-recipes.md](tool-recipes.md) has a tested rule for each common tool.

```yaml
detect:
  command:
    run: [ty, check, --output-format, gitlab, "{{files}}"]
    output: gitlab
    rules: [invalid-assignment]       # optional: only these rule ids
    exit_codes: { error: [2, 101] }   # optional: these codes mean the tool failed
```

- `run`: the command and its arguments, run from the project root, or from `cwd`. The argument that is exactly `{{files}}` is replaced by the rule's files; if there is no such argument, the files are appended. A rule that selects no files does not run the command at all.
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
- `cwd`: the directory to run the command in, relative to the project root, for a tool that has to start where its own config is: `cwd: backend` runs pytest from `backend/`. It must be inside the project; an absolute path or one that leaves it with `..` is a `rulecast validate` error. The files in `{{files}}` are given relative to it, a relative `run[0]` such as `./check.sh` is found from it, and paths in the output are read relative to it. Findings still name files from the project root.
- `stream`: `stdout` (default), `stderr`, or `both` for a tool that reports on stderr.
- `rules`: keep only findings with these rule ids. Rules with the same `run`, `output`, `stream`, `scope`, `exit_codes` and `cwd` share one run and split its findings, so three semgrep rules scan once.
- `exit_codes`: `{ error: [...] }` names the exit codes that mean the tool failed rather than found something — ty exits 1 on findings and 2 on a bad config, vulture 3 on findings, semgrep 0 either way. A listed code disables the rule with the tool's first lines of stderr. Every other code is read as findings-or-clean: the output is the answer.
- `scope`: `files` (default) gives the tool the rule's files. `project` runs it without files (`{{files}}` resolves to nothing) and keeps only the findings in the rule's files. Use it for a type checker, a dead-code tool or a duplication finder, whose answer about a file depends on the rest of the project.
- `captures`: extra names your message uses, each a string field the tool emits on **every** finding (JSON fields, SARIF `properties`, a pattern's named groups). A missing one disables the rule, so the mistake is visible rather than silently blank. A capture may not shadow `file`, `line`, `column`, `text` or `rule`.
- Every finding carries `{{message}}`, `{{ruleId}}` and `{{severity}}` (the tool's own word: `error`, `major`, `note`; empty when it gave none). `{{text}}` is the source at the finding's range, unless a JSON result gives its own `text`.
- Output that cannot be parsed disables the rule.
- In a staged run or with `--to-ref`, a `files` rule judges a scratch copy and a `project` rule may be skipped: see [In staged and `--to-ref` runs](#in-staged-and---to-ref-runs).
- Default stages: `edit`, `verify`; **`verify` only with `scope: project`**, since a whole-project run is usually too slow for an edit. Write `stages: [edit, verify]` if your `project` tool is fast enough (tflint takes about 40 ms). A `files` tool runs on edits already; give a slow one, such as semgrep, `stages: [verify]`.

## `hook`

```yaml
detect:
  hook:
    pre-commit: mypy                 # a hook id in .pre-commit-config.yaml
    # lefthook: pre-commit/typecheck # or a lefthook job: <hook>/<job>
    # hk: pre-commit/eslint          # or an hk step: <hook>/<step>
    output: { lines: gcc }           # default
```

Runs a hook the project already declares, so the agent sees the same thing a commit would show it, with the rule's message and doc section.

- `pre-commit`: a hook id (or alias) in `.pre-commit-config.yaml`. rulecast runs `prek run <id> --files <files>` when prek is installed, else `pre-commit run …`, from the project's `node_modules/.bin` or `PATH`. That mode never stashes. A hook whose `stages` leave out `pre-commit` is run at its first stage. `rulecast validate` names an id the config does not declare.
- `lefthook`: `<hook>/<job>` in lefthook's merged config (`lefthook dump`), including jobs inside groups and lefthook 1's `commands:`. rulecast runs the job's `run` command itself, from the job's `root`, with the rule's files in place of `{staged_files}`, `{files}`, `{all_files}` and `{push_files}`. It does not call `lefthook run`, which can install git hooks. The job's `glob` is not applied: the rule's `files` decide.
- `hk`: `<hook>/<step>` in `hk.pkl` (or `.config/hk.pkl`, which hk reads when there is no `hk.pkl`); not a `commit-msg` step, which checks the commit message. rulecast runs `hk run <hook> --check --step <step> --stash none --no-stage --format json <files>` from the repository's top, so only the step's check command runs, never its fix, and the working tree is left as it is. A `pre-push` step also gets `--from-ref HEAD --to-ref HEAD` and stand-ins for the remote and its url before the files: hk then checks exactly those files and never asks the git remote for its default branch. The step's own output is read; hk filters the files by the step's `glob`. `init` offers hk's steps only when hk is installed, since hk.pkl is Pkl and only hk evaluates it, and only when hk's Pkl package is already in its cache, so nothing is downloaded; it never reads pre-push steps, since hk asks the git remote for them. `doctor` checks steps under the same rule. A hook rule does not run hk either while its Pkl package is not in hk's cache (`$HK_PKL_CACHE_DIR`, else pklr's folder in the platform's cache directory): the rule's error says so and names `hk validate`, which downloads it once. Every hk call also runs with `HK_PKL_OFFLINE=1`, so hk itself refuses to download.
- A rule names exactly one of `pre-commit`, `lefthook` and `hk`. When the repository has no config for that hook manager (`.pre-commit-config.yaml`, a lefthook config, `hk.pkl`), `rulecast validate` and `rulecast doctor` say the manager is not set up here, as after a move to another manager.
- `output`, `rules`, `exit_codes`, `captures`: as for `command`. The runner's own framing (pre-commit's status line and `- hook id` block, prek's indent) is removed before the output is read.
- A hook that changes a file — a formatter, a fixer — has the file put back as it was, and each changed file is a finding: `{{message}}` is "<hook> would change this file". rulecast never rewrites an agent's file behind its back. Only the rule's files are compared.
- A hook that fails and prints nothing the `output` format reads is never pinned to a file it did not name. When its output names a line in one of the rule's files (`path:line` anywhere in a line, as ty's ` --> a.py:3:5`, `./a.py:3` or `Dockerfile:12`, for a file that exists), that line is the finding, carrying the hook's first lines of output. When it names a line in another rule's files from the same run, this rule gets nothing. When it names no file but was given exactly one (a pre-commit hook without `always_run` or `pass_filenames: false`, read from the config and, for a remote hook, from the `.pre-commit-hooks.yaml` of the clone pre-commit or prek already made at that rev, else taken as not given; a lefthook job with a files template), the finding is on that file. When it names only files the run did not give it, as a whole-project or `always_run` hook can, or no file in any other case (several files, an hk step), the rule gets an error that says so and quotes the output, and `rulecast run` exits 3, as for any rule that could not give an answer (output.md).
- A hook whose tool could not start checked nothing: exit 126 or 127, or, when nothing else it printed is a finding or a `path:line`, words such as "Failed to spawn", "command not found", "Executable `x` not found" or "bad interpreter". Then the rule gets an error saying it could not run and what the hook printed, not a finding, and `rulecast run` exits 3.
- A runner that never ran the hook (an unknown id, an environment it could not install) disables the rule with what it said.
- `rulecast doctor` reports the runner it would use and every hook id, job or step it cannot find.
- husky is not supported: its hooks are shell scripts with nothing structured to read. Use `command` with the script's command.
- In a staged run or with `--to-ref`, a hook rule may be skipped: see [In staged and `--to-ref` runs](#in-staged-and---to-ref-runs).
- Default stages: **`verify` only.** Hooks are written for a commit, not a keystroke. Write `stages: [edit, verify]` if yours is fast.

## In staged and `--to-ref` runs

In a staged run (`rulecast run` with no file flags, the pre-commit check) or with `--to-ref`, the content to judge is the index or a commit, not the file on disk. So the tools are handed that content:

- `ruff` and `eslint` get each file's content on stdin under its real path, one process per file, so path-keyed configuration (`per-file-ignores`, eslint `files:` globs) applies as usual. `gitleaks` gets it on stdin under no file name.
- `oxlint` and `command` rules with `scope: files` get a copy of each file under a scratch directory (`.rulecast-staged-XXXX/<path>`), and findings are mapped back to the real path. A script that decides by path should match the end of the path, not its start. oxlint's path-keyed configuration does not match the copy.
- A tool that runs the project's tests (coverage, mutation testing) cannot judge the copy, because the tests never import it: give such a rule `scope: project`, and let the tool pick the changed code itself.
- `command` rules with `scope: project` and `hook` rules need the real project. They run on the working tree when its matching files equal what is being judged, and are skipped with a warning naming the files otherwise. rulecast never stashes to make them match.

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
- `fix`: optional, the replacement `rulecast fix` writes over each match, in ast-grep's syntax (`$NAME`, `$$$NAMES`). Only the string form: no `FixConfig` object, `transform` or `rewriters`. See [rule-format.md](rule-format.md#fixes).
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
- `fix`: optional, the replacement `rulecast fix` writes over each match, in the `{{name}}` syntax with the named groups and `{{text}}`. See [rule-format.md](rule-format.md#fixes).
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

## `llm`

```yaml
detect:
  llm:
    model: haiku
    question: >
      Does this route do more than parse input, call a service,
      and return the result? Report each offending line.
    grounding: true
    # removed_definitions: true    # show it the definitions the change removed from its other files
```

- `model`: optional. Either a rulecast alias — `haiku`, `sonnet`, `opus`, `fable` — which `claude-code`, `anthropic` and `opencode` map to their own names (`openai-compatible` has no aliases: name its exact model), or the exact model name your provider uses (`claude-haiku-4-5-20251001`, `gpt-5-mini`, `qwen3-coder:30b`), which is passed through untouched. Without it the rule runs on the config's `llm.model`. That key is set when the developer agrees to llm rules, so a config without it has no llm rules: don't propose one there, and a rule with no model of its own fails `rulecast validate`.
- `question`: what the model is asked about the file. Ask for specific lines — "Report each offending line" — or you get an essay instead of findings.
- `removed_definitions`: optional, default false. The model sees one file at a time, so a class moved into a new file looks new. With `true`, the prompt also lists the definitions (`class`, `def`, `function`, `interface`, `type`, `fun`, Java and C# methods, and the like, with their modifiers such as `public` or `data`) that the change removed from its other files, deleted and moved files included, at most 60, so a moved one reads as moved. It needs a commit to compare with: the session's start commit at a stop, `--from-ref`, or HEAD in a staged run. Use it for rules that ask whether something in the change is new. Such a rule gets its own model call per file.
- `grounding`: defaults to `true`. Sends the rule's `context` references with the question, whatever their delivery mode, so the model judges against your conventions rather than its own taste. Set it to `false` when the question stands alone.
- Which model is the developer's choice. Haiku is reliable only on simple, clear questions ("is this prose in the past tense?"); a rule that takes judgement needs Sonnet or stronger. `rulecast test <id> --runs 5` shows how often a rule passes its examples on its model.
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

  Each `base_url` follows its own ecosystem's SDK convention, so a URL copied from your provider's docs works as written. **Azure OpenAI is not supported**: it needs a per-deployment path with an `api-version` query string and an `api-key` header, which no `base_url` can express.

### Writing the question

The model is asked to report each line that breaks a rule, so a question works when it names something a line can be. Most of this comes from [abide](https://github.com/coldteadotai/abide)'s rules for compiling questions, where a vague one scored the same on every diff and never fired.

- **One idea per rule.** A convention with two parts is two rules, each with its own question and message.
- **Name the thing to report, not a quality.** "A comment that restates the line below it, with no reason, constraint or gotcha" gets lines back. "Are comments sparing?" gets an essay, or nothing.
- **Leave scope out of the question.** `files` and `exclude` say where the rule applies; "for a file under `app/api`" in the question only costs tokens.
- **A rule about amount** ("comment sparingly", "keep functions short") has two parts. The `llm` rule takes the concrete offence. The amount goes to a `command` rule if it can be counted, such as lines in a file or a function, and otherwise to a touch rule that delivers the section.
- **A question about the whole change** has no answer one edit in: a helper with one caller, duplicated logic, work nobody asked for. Keep such a rule on `verify`, the default, so it judges the turn. Where a tool answers it, prefer the tool (`jscpd` for duplication, `knip` for unused code, as a [`command`](#command) rule).
- **Ground it.** Cite the doc section with `context` and keep `grounding` on: the section carries the project's own examples, and the model judges against them instead of its own taste.
- **Measure it before keeping it.** `rulecast test <id> --history` judges it on recent commits ([output.md](output.md#history-the-rule-on-recent-commits)), and `rulecast replay claude-code --rule <id> --llm` on recent agent sessions ([stats.md](stats.md#rulecast-replay)). Start it as `severity: warning`, which never blocks a stop, until the developer has seen its precision and accepts it. Each file the agent changed is one more chance for a rule that is sometimes wrong to block.

**An llm rule sends the file's contents and the rule's grounding to the configured provider, and costs money for every file that is not already cached.** So `rulecast run` with no file flags, the pre-commit check, skips llm rules unless given `--llm`, and says so in one line. `--all-files`, `--from-ref` and the agent's stop run them; `--no-llm` skips them anywhere. It is the right answer only when no pattern can express the convention. Reach first for the detectors [DRAFT-RULES.md](../DRAFT-RULES.md#2-sort-the-conventions) lists, in its order (`path` when the file is the break, else a `linter` rule, a `command`, `ast-grep`, and `regex` only for text): they cost nothing per file and give the same answer every time. If you cannot write the check mechanically but the convention still matters, a `stages: [touch]` rule that delivers the section is usually better than asking a model — it puts the convention in front of the agent before the code is written, instead of judging it afterwards.
