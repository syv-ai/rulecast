# rulecast rule format

Rules and settings live in `.rulecast-config.yaml` at the project root. Keys are snake_case. `rulecast validate` checks the file.

Relative links in this file resolve against this file's own URL.

```yaml
exclude: ^vendor/
repos:
  - repo: https://github.com/syv-ai/rulecast
    rev: v0.2.0
    rules:
      - id: python/no-httpexception-in-services
        files: ^app/services/
        context: ["@AGENTS.md#errors"]
  - repo: local
    rules:
      - id: api/no-client-in-components
        name: Components never call the API client
        files: ^frontend/src/components/
        types: [tsx]
        exclude: \.test\.tsx$
        detect:
          regex:
            pattern: 'from "@/client"'
        message: "{{file}}:{{line}} imports the API client. Use the feature's query hook."
        context:
          - "@docs/api-access.md#frontend-data-flow"
```

## Top-level keys

| Key | Default | Meaning |
|---|---|---|
| `repos` | required | Repo entries (below) |
| `minimum_rulecast_version` | none | `X.Y.Z`: older rulecast versions reject the config |
| `files` | `""` | Regex every rule's files must also match |
| `exclude` | `^$` | Regex no rule's files may match |
| `default_stages` | none | Stages for rules without `stages` |
| `context.mode` | `inject` | Default reference mode: `inject` or `read` |
| `context.max_bytes` | `32768` | A larger reference is delivered as `read` |
| `max_matches_per_rule` | `10` | Findings shown per rule |
| `timeouts.edit_deadline_ms` | `350` | Detection deadline after an edit |
| `timeouts.verify_ms` | `60000` | Detection timeout when an agent stops and in `rulecast run` |
| `stop_gate.max_blocks` | `1` | Stops blocked per agent per user prompt |
| `llm.provider`, `llm.base_url`, `llm.api_key_env`, `llm.max_files_per_verify` | `claude-code`, `null`, `ANTHROPIC_API_KEY`, `10` | Settings for the `llm` detector. `provider` is one of `claude-code`, `opencode`, `anthropic`, `openai-compatible`. There is no `llm.model`: every llm rule names its own |

## Repo entries

- `repo`: a git URL, or `local` for rules written in this file.
- `rev`: required for a URL, not allowed for `local`. A tag or a full commit SHA; `rulecast autoupdate` moves it to the latest tag.
- `rules`: for a URL, entries that select rules from the repo's `.rulecast-rules.yaml` by `id` and may override any other key. For `local`, complete rules.

## Rule keys

| Key | Required | Meaning |
|---|---|---|
| `id` | yes | `[a-z0-9-]+(/[a-z0-9-]+)*`, unique within its repo |
| `alias` | no | A second name, unique across the config, so one repo rule can be selected twice with different overrides. Findings use it |
| `name` | for `local` and published rules | Short title |
| `description` | no | Longer text, shown by `rulecast init` |
| `files` | no, default `""` | Regex searched in the repo-relative path (forward slashes, not anchored: add `^` and `$` yourself) |
| `exclude` | no, default `^$` | Regex: matching files are skipped |
| `types` | no, default `[file]` | The file has every one of these type tags |
| `types_or` | no | The file has at least one of these |
| `exclude_types` | no | The file has none of these |
| `stages` | no | Subset of `touch`, `edit`, `verify` (below) |
| `severity` | no, default `error` | `error` blocks the agent's stop and fails `rulecast run`; `warning` is delivered and never blocks |
| `detect` | unless `stages: [touch]` | One detector, `{ <kind>: <config> }`: see [detectors.md](detectors.md) |
| `message` | with `detect` | Template with `{{file}}`, `{{line}}`, `{{column}}`, `{{text}}`, `{{rule}}` and the detector's captures |
| `context` | for touch rules | References delivered with the rule (below) |
| `minimum_rulecast_version` | no | `X.Y.Z`, for rules published in rule repos |

A rule applies to a file when the top-level `files` and `exclude`, the rule's `files` and `exclude`, and its type keys all match.

### Messages

A rule that fires three or more times has its `message` printed once, with the variables shown as `{name}`, and one line per site under it carrying that site's values. So write the message as one sentence that holds for every site — what to do instead, not just what is wrong — and let the capture groups carry what differs. A message that is nearly all variables, such as `"{{file}}:{{line}} {{text}}"`, has nothing to print once and is repeated per finding as before.

### File types

`file` (every file), `text` (every extension below), `python` (`.py`, `.pyi`), `pyi`, `ts` (`.ts`, `.mts`, `.cts`), `tsx`, `javascript` (`.js`, `.mjs`, `.cjs`), `jsx`, `markdown` (`.md`), `mdx`, `yaml` (`.yaml`, `.yml`), `json`, `toml`, `css`, `scss`, `html`, `shell` (`.sh`), `sql`, `go`, `rust` (`.rs`), `plain-text` (`.txt`). `ts` does not include `tsx`: write `types_or: [ts, tsx]`. An unknown tag is a `rulecast validate` error.

### Stages

- `touch`: the first time an agent reads or edits a matching file in its context, the rule's `context` is delivered, without a message.
- `edit`: the detector runs on each file the agent edits.
- `verify`: the detector runs when the agent stops, on the files it changed, and in `rulecast run`.

Defaults, in order: the rule's `stages`, then `default_stages`, then `[touch]` for rules without `detect` or the detector's own defaults. A rule without `detect` needs `stages: [touch]` and `context`. A rule with `detect` needs `edit` or `verify` among its stages.

### Overrides

An entry under a URL repo is merged over the published rule key by key. The merge is shallow: an overridden `detect` or `context` replaces the whole value. `@` paths in an overriding `context` resolve against your project; the published rule's own paths resolve against the rule repo.

## Context references

```yaml
context:
  - "@AGENTS.md"                       # the whole file
  - "@AGENTS.md#frontend-data-flow"    # one section
  - path: "@docs/state.md"
    mode: read                         # tell the agent to read it instead
```

- **Path**: `@` plus a path relative to the project root, or to the rule repo's root for rules published there. Any text file. A path may not leave its root.
- **Anchor**: `.md` and `.mdx` only. The GitHub heading slug: lowercase, punctuation dropped, spaces turned into `-`; repeated headings get `-1`, `-2`. The section runs from its heading to the next heading of the same or a higher level, subsections included.
- **Mode**: `inject` delivers the content; `read` tells the agent to read the file. The default is `context.mode`.

rulecast dedupes references: content the agent already has in its context is not delivered again.
