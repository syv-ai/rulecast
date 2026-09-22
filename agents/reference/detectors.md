# rulecast detectors

A rule's `detect` names one detector and its config. The message template of every match can use `{{file}}`, `{{line}}`, `{{column}}`, `{{text}}` (the matched text) and `{{rule}}`, plus the detector's captures. Any other variable is a `rulecast validate` error.

## `regex`

```yaml
detect:
  regex:
    pattern: 'raise HTTPException\((?<args>[^)]*)\)'
    flags: m
```

- `pattern`: a JavaScript regular expression, searched in the whole file. Quote it with single quotes in YAML so backslashes stay as written.
- `flags`: any of `d`, `i`, `m`, `s`, `u`, `v`, `y`; default none. `g` is always added. Use `m` for `^` and `$` at each line, `s` for `.` across lines.
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

```yaml
detect:
  command:
    run: ["uv", "run", "python", "scripts/check_layers.py", "{{files}}"]
    output: json            # json | sarif
    captures: [layer, target]
```

- `run`: the command and its arguments, run from the project root. The argument that is exactly `{{files}}` is replaced by the rule's files; if there is no such argument, the files are appended. A rule that selects no files does not run the command at all.
- `output`: `json` is an array of `{ file, line, endLine?, column?, text?, ...captures }`. `file` may be absolute or repo-relative. `sarif` is read as SARIF 2.1.0, taking `runs[].results[]`; a result with no location is skipped, and captures are read from the result's `properties`.
- `captures`: the names your message uses. Each must be a string on **every** result — a missing one disables the rule, so the mistake is visible rather than silently blank. A capture may not shadow `file`, `line`, `column`, `text` or `rule`.
- The exit code is ignored: finding something is not failing. Output that cannot be parsed disables the rule and is reported by `rulecast validate`.
- Default stages: `edit`, `verify`.

## `linter`

```yaml
detect:
  linter: { tool: ruff, rules: [T201] }
```

- `tool`: `ruff`, `oxlint` or `eslint`. rulecast looks for it in the project's `node_modules/.bin`, then — for `ruff` in a project with a `pyproject.toml` — as `uv run ruff`, then on `PATH`. A tool that is not installed disables its own rules and nothing else.
- `rules`: the linter's own rule ids to report. Leave it out to take every finding the tool reports.
- One process per tool per event, over every file its rules select together, with the findings handed back to the rules that asked for them. Ten `ruff` rules cost one `ruff` run.
- Captures: `{{ruleId}}` and `{{message}}`. `{{text}}` is the source the linter pointed at.
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
- Providers are configured once for the project, in `llm.provider`: `claude-code` (the default — shells out to `claude -p`, and needs no API key on a machine signed in to Claude Code), `opencode`, `anthropic` and `openai-compatible` (the last two read `llm.api_key_env` and honour `llm.base_url`, which is how you reach Azure OpenAI or a local Ollama).

**An llm rule sends the file's contents and the rule's grounding to the configured provider, and costs money for every file that is not already cached.** It is the right answer only when no pattern can express the convention. Reach for `path`, `regex` and `ast-grep` first: they are free, instant and exact. If you cannot write the check mechanically but the convention still matters, a `stages: [touch]` rule that delivers the section is usually better than asking a model — it puts the convention in front of the agent before the code is written, instead of judging it afterwards.
