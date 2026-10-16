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
| `mode` | none | `attended` or `unattended`: whether a person answers the agent. `RULECAST_MODE` overrides it, and it overrides CI detection ([below](#unattended-mode)) |
| `unattended.max_blocks` | `10` | Stops blocked per agent per prompt in unattended mode, instead of `stop_gate.max_blocks` |
| `unattended.escalate` | `[]` | Ids of `warning` rules that are `error` in unattended mode |
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
| `escalate` | no, default `false` | `true`: `error` in [unattended mode](#unattended-mode), whatever `severity` says. The same as listing the id in `unattended.escalate`. A catalog rule's `escalate: true` is turned off with `escalate: false` on its entry |
| `scope` | no, default `instance` | Whether the convention belongs to the matched token or to the node around it, or, with `removed`, whether a file lost matches (below) |
| `refuse_write` | no, default `false` | Refuse an edit-tool write when this rule fires on what the agent is writing; catch a shell write right after it (below). `unattended`: only in [unattended mode](#unattended-mode) |
| `enabled` | no, default `true` | `false` switches the rule off without deleting it; works as an override on a catalog rule (below) |
| `detect` | unless `stages: [touch]` | One detector, `{ <kind>: <config> }`: see [detectors.md](detectors.md) |
| `message` | with `detect` | Template with `{{file}}`, `{{line}}`, `{{column}}`, `{{text}}`, `{{rule}}` and the detector's captures; a removed rule also has `{{removed}}` and `{{baseline}}` (below) |
| `context` | for touch rules | References delivered with the rule (below) |
| `examples` | no | Code the rule must flag and must not, run by `rulecast test` (below) |
| `minimum_rulecast_version` | no | `X.Y.Z`, for rules published in rule repos. Read before the rest of the rule, so an older rulecast says to upgrade rather than rejecting a key it does not know |

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

### Removed rules

`scope: removed` turns the question round. A match is something the code should *keep*, such as
an assertion in a test, and the finding is a file that has fewer matches than it had at its
baseline:

```yaml
- id: tests/keep-assertions
  files: '(^|/)tests/.*\.py$'
  scope: removed
  detect:
    ast-grep:
      language: python
      rule: { kind: assert_statement }
  message: "{{file}}:{{line}} removes assertions ({{removed}} of {{baseline}} removed). Put them back, or, if you combined them on purpose, keep that and say so in your report."
```

There is one finding per file, always new. It sits on the first line the change touched (the
file's last line, for a deletion at its end). The message says how many went with `{{removed}}`
and how many the file had at its baseline with `{{baseline}}`, so the example above reads
`2 of 5 removed`. Its `{{text}}` is always `removed`: deleting one more match is the same finding,
not a new one, so an unattended run that keeps deleting is blocked at most twice for it, like any
other finding (see [Unattended mode](#unattended-mode)). A match by itself is never a finding, and adding, moving or rewriting matches is
nothing as long as the count does not drop. The count is compared when the agent stops and in
`rulecast run`, not after each edit: an edit may cut an assertion that the next edit pastes
somewhere else. Matches on a
line with a `rulecast-ignore` still count, and the finding is not on a matched line, so an ignore
comment does not silence it; use `enabled: false` or `exclude`.

What it needs:

- **A baseline.** In an agent session that is the file as the agent first read it, or the session's
  start commit. A file the agent changed before it read it, with its shell, keeps the start commit
  as its baseline: the read comes after the change. `rulecast run --from-ref`
  counts against the merge base, and a staged run against `HEAD`. `rulecast run --files` and
  `--all-files` have no baseline, and a removed rule reports nothing there.
- **A detector that reads the content it is handed and reports each match in it:** `regex` or
  `ast-grep`. Not `path`, whose match is the whole file, and not a linter, command or `llm`.
- **`edit` among its stages,** which is the default for both. A session's baseline is taken when the
  agent opens a file, by the edit-stage rules. It cannot be combined with `refuse_write`.
- **A file that still exists.** A deleted file has nothing to count and is not reported. Nor is a
  renamed one (`git mv`): it is a deleted file and a new one, and the new path has no baseline.

It counts, so it cannot tell which match went: deleting one assertion and adding an unrelated one
leaves the count where it was. Nor can it tell a deletion from a consolidation: three asserts
folded into one parametrized test, or several `expect`s into one `toEqual`, lower the count and are
reported. Say so in the rule's message, so the agent keeps a deliberate consolidation and mentions
it in its report rather than undoing it. A file over `max_file_bytes` is not counted. Only projects with a
removed or container rule pay for the baseline measurement.

`examples` on a removed rule show what it counts: a `bad` example has at least one match, which
deleting would report, and a `good` one has none. `rulecast test --against` does not count a
removed rule: its matches are what a file keeps, not violations.

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

`refuse_write: unattended` refuses only in [unattended mode](#unattended-mode), and is an ordinary
rule otherwise. Use it for a write a developer could make on purpose, but a loop with nobody
watching should not. Its requirements are the same as for `true`.

### Unattended mode

The stop gate assumes someone is in the loop. When the agent stops with new `error` findings, the
gate blocks the stop and the agent gets a turn to fix them. That happens once per user prompt
(`stop_gate.max_blocks`). After that the findings go to the developer as a message. A goal loop
(Claude Code's `/goal`), `claude -p`, a scheduled task or a CI job sends one prompt and has nobody
reading messages, so it gets one block per run. After that enforcement quietly ends.

In unattended mode:

- **The stop gate blocks every stop with new error findings, up to `unattended.max_blocks`** (10)
  per prompt.
- **A finding that has blocked two stops no longer blocks.** It is reported instead, so a false
  positive, with nobody to overrule it, cannot use up the budget. A finding is the same finding when
  its rule, its file and the text it matched are the same, wherever the line has moved. When the
  text tells nothing apart (a redacted secret, a hook's whole-file finding), the tool's rule id,
  message and line are compared too. A `refuse_write` finding in a protected file the agent changed
  with its shell is the exception: it keeps blocking until the change is reverted.
- **When nothing is left that may block, the agent is held once more, to report.** This happens when
  the budget is spent, or when every remaining finding has blocked twice. The agent is given the
  findings and told to record each one as unresolved in its final report, or in the run's decisions
  file if it keeps one, and then finish. This happens once per prompt. A later stop is let through
  with the findings in a message, as in attended mode.
- **A block tells the agent that nobody is there to ask.** If it believes a finding is wrong, it
  leaves the code, records the finding and its reason in the decisions file or final report, and
  carries on. In attended mode it would say so to the developer.
- **A `rulecast-ignore` does not silence a finding on a line the agent changed during the run,
  whoever wrote the comment.** Ignores on code the run did not touch keep working. The finding is
  judged like any other: it blocks, and is reported if it keeps blocking. That includes an edit to
  code under a comment that was already there: the comment was agreed to for the code as it was.
  The developer is still told about an ignore on changed code. A `refuse_write` rule works the same
  way: an ignore does not stop the refusal of a line the write changes, while a write that only
  restates a line, or an edit that carries it as context, does not change it.
- **Rules can be stricter.** `unattended.escalate` makes named `warning` rules errors, as does
  `escalate: true` on the rule itself, and `refuse_write: unattended` rules refuse writes.

The mode is decided in this order:

1. `RULECAST_MODE`: `unattended`, or `attended` (also `interactive`). It overrides the config, so
   an orchestrator can set it per run.
2. `mode:` in `.rulecast-config.yaml`.
3. `CI` or `GITHUB_ACTIONS` set (and not `false`, in any case, or `0`): unattended.
4. Otherwise attended.

An unknown `RULECAST_MODE` value is ignored: `rulecast doctor` warns about it, and a hook writes it
to its debug log. A missing terminal does not count, because a hook never has one. `rulecast doctor` prints the mode
it would run in from your shell, and where that came from. The mode applies to agent hooks only.
`rulecast run` in a git hook or a CI job always runs the rules as written: there is no agent there
to answer. The exception is `rulecast run --session <id>`, which shows a session's findings: it runs
in the mode that session's hooks recorded, so it lists what the stop blocks on. For a session
recorded before modes were, it resolves the mode from its own environment as a hook would.

**With `/goal`.** `/goal` is a Stop hook too. While a goal is active, its evaluator and rulecast
both run on every stop. A rulecast block is answered by a fixing turn even when the evaluator says
the goal is met, and the evaluator judges only its own condition. `/goal` sends no new prompt
between turns, so `unattended.max_blocks` is in effect a budget for the whole run. rulecast does
not read `stop_hook_active`: it is `true` after any hook's block, `/goal`'s included, so rulecast
counts its own blocks in its session store instead. Two recorded runs are in
`docs/evidence/2026-10-16-unattended-goal-runs.md` in the rulecast repository.

```yaml
mode: unattended
unattended:
  max_blocks: 6
  escalate: [python/no-print]
```

### Examples

`examples` holds `good` code the rule must leave alone and `bad` code it must flag. `rulecast test`
runs them; `rulecast test <id> --against <paths>` fires the rule over real files and says how many
violations it would produce and in how many of the files it matches. Without an id,
`rulecast test --against <paths>` prints that count for every rule, one line each.

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

Defaults, in order: the rule's `stages`, then `default_stages`, then `[touch]` for rules without `detect` or the detector's own defaults. Those are `edit` and `verify`, except `verify` only for `llm`, `eslint`, `hook`, and `command` with `scope: project`: each is too slow to be felt on every edit, and `stages: [edit, verify]` asks for it anyway. A rule without `detect` needs `stages: [touch]` and `context`. A rule with `detect` needs `edit` or `verify` among its stages.

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
