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

## Coming later

`ast-grep` (structural patterns), `command` (your own script), `linter` (ruff, oxlint, eslint) and `llm` (a model's judgement) are designed but not in this version: `rulecast validate` reports `unknown detector` for them. Until then, write the convention as a `regex` rule when a text pattern catches it well, or as a `stages: [touch]` rule that delivers the section.
