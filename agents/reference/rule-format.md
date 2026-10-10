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
| `max_file_bytes` | `1048576` | A larger file is skipped by the in-process detectors (`regex`, `path`, `ast-grep`) on edit and guard, where an agent is waiting. `verify` always runs |
| `timeouts.edit_deadline_ms` | `350` | Detection deadline after an edit |
| `timeouts.verify_ms` | `60000` | Detection timeout when an agent stops and in `rulecast run` |
| `stop_gate.max_blocks` | `1` | Stops blocked per agent per user prompt |
| `refuse_gate.max_refusals` | `1` | Writes a `refuse_write` rule may refuse per file per session |
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
| `scope` | no, default `instance` | Whether the convention belongs to the matched token or to the node around it (below) |
| `refuse_write` | no, default `false` | Refuse an edit-tool write when this rule fires on what the agent is writing; catch a shell write right after it (below) |
| `enabled` | no, default `true` | `false` switches the rule off without deleting it; works as an override on a catalog rule (below) |
| `detect` | unless `stages: [touch]` | One detector, `{ <kind>: <config> }`: see [detectors.md](detectors.md) |
| `message` | with `detect` | Template with `{{file}}`, `{{line}}`, `{{column}}`, `{{text}}`, `{{rule}}` and the detector's captures |
| `context` | for touch rules | References delivered with the rule (below) |
| `examples` | no | Code the rule must flag and must not, run by `rulecast test` (below) |
| `minimum_rulecast_version` | no | `X.Y.Z`, for rules published in rule repos |

A rule applies to a file when the top-level `files` and `exclude`, the rule's `files` and `exclude`, and its type keys all match.

### Instance and container rules

rulecast only reports what the agent's own edit caused; everything else is summarised as pre-existing
and never blocks. `scope` says how it decides.

`instance`, the default, calls a finding new when the agent's edit touched the lines the detector
matched. That is right when the convention is about a token: a `crud.` call in a route is a violation
at the line it sits on, and an edit that adds one is an edit that touched it.

`container` calls a finding new when the node the match spans was *not already violating the rule*
before the agent started. Use it when the convention is a property of the enclosing function or
component:

```yaml
- id: python/slim-routes
  files: '(^|/)routes/.*\.py$'
  scope: container
  detect:
    ast-grep:
      language: python
      rule: { kind: function_definition, has: { kind: if_statement, stopBy: end } }
  message: "{{file}}:{{line}} has branching in a route. Move the decision into a service."
```

Without `scope: container` this rule would fire on every edit anywhere inside a long route, because
the match is the whole function and so overlaps every change in it. Measured over 1,377
agent-written sites, that is precision 0.62; the container comparison is 0.76.

Two things to know before reaching for it:

- **A second violation added to an already-violating container is pre-existing.** The rule is about
  the container, and the container was already broken. If you want every added occurrence reported,
  the convention is really about the token — use `instance`.
- **It needs a baseline to compare against.** Where rulecast has none for a file — the file was
  changed outside the agent's tools, or is over `max_file_bytes` — a `container` rule falls back to
  `instance`. An `llm` rule always does: measuring its baseline would mean a second model call every
  time the agent opens a file.

### Turning a rule or a finding off

- **A whole rule:** `enabled: false`. Under a URL repo, an entry `- id: <rule>` with `enabled: false` switches a catalog rule off and keeps the entry, so re-enabling it is one line.
- **One finding:** a comment on the matched line or the line above it, in the file's own comment syntax:

  ```python
  # rulecast-ignore: python/no-httpexception-in-services legacy endpoint, removed in #412
  raise HTTPException(404)
  ```

  The id is the one the finding shows. **The reason is required**: an ignore without one suppresses nothing and is reported. Ignores are counted under `rulecast run --all-files --summary` and listed by `--format json`, and one added during an agent session is reported to the developer when the agent stops. An agent adds one only when the developer agrees the finding is wrong.

### Refusing a write

`severity` decides how loud a finding is after the fact: `error` blocks the agent's stop, `warning`
never blocks. `refuse_write` is a different axis — it refuses the edit itself, before the file
changes, and the agent is shown the rule's message and the section it cites instead of a result.

```yaml
- id: codegen/no-edit-client
  files: '^src/client/'
  detect:
    path: {}
  refuse_write: true
  message: "{{file}} is generated from openapi.yaml. Edit the schema and run `pnpm codegen`."
```

Use it where the right answer is "not this file, not this way" — generated code, a vendored
directory, a secret that must not be committed — rather than for anything the agent could fix after
writing it. Three things it does not do, all deliberate:

- **It only fires on what the agent is writing.** The same violation already in the file, on a line
  the edit does not touch, is reported after the write as usual. A rule that fires on an absence
  ("every service needs a docstring") can never refuse, because the evidence is not in the new text.
- **It gives up rather than guess.** If the edit cannot be applied exactly as the tool describes it
  — `old_string` missing, or appearing twice without `replace_all` — the write goes ahead.
- **It refuses once per file per session** (`refuse_gate.max_refusals`), so a rule cannot trap an
  agent that has no way to satisfy it.

**A write made with the shell is caught right after it, not refused.** Nothing can know what a
command such as `sed -i` will write before it runs. So rulecast compares the working tree before and
after the command: a `refuse_write` finding in a file the command changed is told to the agent at
once, with how to revert it (`git checkout -- <file>`, or "undo only your change" when the file had
uncommitted work before the session). Stop is blocked while the finding is new, whatever the rule's
severity, and the developer is told which file the agent changed.

`refuse_write` needs a detector that can judge content it is handed: `regex`, `path` or `ast-grep`.
`linter`, `command` and `llm` hand a path to another program, which would read the file as it still
is, so `rulecast validate` rejects them.

### Examples

`examples` holds `good` code the rule must leave alone and `bad` code it must flag. `rulecast test`
runs them; `rulecast test <id> --against <paths>` fires the rule over real files and says how many
violations it would produce and in how many of the files it matches.

```yaml
examples:
  good:
    - path: backend/app/services/users.py
      code: |
        log.info("created user %s", user.id)
  bad:
    - path: backend/app/services/users.py
      code: |
        print("created user", user.id)
```

- **`path` is required** and must match the rule's own `files`, `exclude` and type keys — those, and
  `ast-grep`'s choice of parser, are all decided by the path, so an example without the right one
  tests a different rule. A path the rule would never be given is a `rulecast validate` error.
- **A `bad` example passes on at least one finding**, not an exact count.
- A `path` rule has no `good` example to give: every file it matches is a violation by definition.
- An `llm` rule's examples are only run when you name the rule — `rulecast test` on its own skips
  them, because running one costs a model call.

Write the examples from real code in the repository rather than inventing them, and treat a failing
example as a wrong rule before a wrong example.

### Messages

A rule that fires three or more times has its `message` printed once, with the variables shown as `{name}`, and one line per site under it carrying that site's values. So write the message as one sentence that holds for every site — what to do instead, not just what is wrong — and let the capture groups carry what differs. A message that is nearly all variables, such as `"{{file}}:{{line}} {{text}}"`, has nothing to print once and is repeated per finding as before.

### File types

`file` (every file), `text` (every extension below), `python` (`.py`, `.pyi`), `pyi`, `ts` (`.ts`, `.mts`, `.cts`), `tsx`, `javascript` (`.js`, `.mjs`, `.cjs`), `jsx`, `markdown` (`.md`), `mdx`, `yaml` (`.yaml`, `.yml`), `json`, `toml`, `css`, `scss`, `html`, `shell` (`.sh`), `sql`, `go`, `rust` (`.rs`), `plain-text` (`.txt`). `ts` does not include `tsx`: write `types_or: [ts, tsx]`. An unknown tag is a `rulecast validate` error.

### Stages

- `touch`: the first time an agent reads or edits a matching file in its context, the rule's `context` is delivered, without a message.
- `edit`: the detector runs on each file the agent edits.
- `verify`: the detector runs when the agent stops, on the files it changed, and in `rulecast run`. A staged `rulecast run` (no file flags, the pre-commit check) skips `llm` rules unless given `--llm`.

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
