<!-- Generated from the repository README by `pnpm readme`. Do not edit by hand. -->

# rulecast

Your project's conventions are written down in `AGENTS.md` or `CLAUDE.md`, and your coding agent read them once, forty tool calls ago. rulecast delivers them again at the moment they matter: when the agent is about to break one.

A rule pairs a check with a message and a pointer to the doc section it enforces. rulecast runs as an agent hook, so when the agent edits a file that breaks a rule, it gets told — in the same turn, before it moves on.

```
rulecast: 1 rule violated in app/services/users.py

error backend/no-httpexception
  app/services/users.py:2 raises HTTPException(404) in the service layer. Raise a domain exception; the API layer maps it to a response.

--- conventions/backend.md#errors ---
## Errors

Services raise domain exceptions. `app/api/errors.py` maps each one to a status code.
```

That is real output. The agent sees the finding *and* the paragraph of your documentation that explains it, without having to go looking.

## Getting started

```sh
npx @syv-ai/rulecast init
```

`init` reads your project — languages, docs, which agents you use — offers a catalog of ready-made rules that apply to your files, installs the hooks for your agent, and validates what it wrote. It shows you every file it will create or change before writing anything.

Then, in your agent, ask it to draft rules for the conventions in your own docs. `init` prints the prompt to paste.

## A rule

Rules live in `.rulecast-config.yaml`:

```yaml
repos:
  - repo: local
    rules:
      - id: backend/no-httpexception
        name: Services raise domain exceptions, not HTTPException
        files: '^app/services/.*\.py$'
        detect:
          regex:
            pattern: 'raise\s+HTTPException\((?<args>[^)]*)\)'
        message: "{{file}}:{{line}} raises HTTPException({{args}}). Raise a domain exception."
        context:
          - "@conventions/backend.md#errors"
```

- `files` selects what the rule applies to; `detect` names one detector and its config.
- `message` is what the agent reads. Named capture groups become template variables.
- `context` points at the doc section that explains the rule — delivered alongside the finding.

A rule with `context` and no `detect` delivers guidance the first time an agent touches a matching file, with nothing to catch. That is how you carry over a convention no pattern can express.

The full format is in [`agents/reference/rule-format.md`](https://github.com/syv-ai/rulecast/blob/main/agents/reference/rule-format.md).

## Detectors

| Detector | Catches | Runs on |
|---|---|---|
| `regex` | A pattern in the file's text | every edit |
| `path` | The file's path alone — "never edit `src/client/`" | every edit |
| `ast-grep` | Structure, not text: a call shape, a swallowed exception | every edit |
| `command` | Whatever your own script reports, as JSON or SARIF | every edit |
| `linter` | ruff, oxlint or eslint findings, narrowed to the rules you care about | edit (eslint: verify) |
| `llm` | Conventions nothing mechanical expresses, judged by a model | verify only |

`llm` rules are opt-in, name their own model, and by default run only when the agent stops, not on every edit. A rule can ask for the edit hook with `stages: [edit, verify]`. Everything else is fast enough to run on every file the agent writes. See [`agents/reference/detectors.md`](https://github.com/syv-ai/rulecast/blob/main/agents/reference/detectors.md).

## Refusing a write

Some rules are not advice. `refuse_write: true` refuses the edit before it happens, and the agent gets your message and the doc section in place of the tool's result:

```yaml
- id: codegen/no-edit-client
  files: '^src/client/'
  detect:
    path: {}
  refuse_write: true
  message: "{{file}} is generated from openapi.yaml. Edit the schema and run `pnpm codegen`."
```

A refusal only ever rests on the text the agent is writing, never on a reconstruction rulecast is unsure of, and it happens once per file per session — so a rule can stop a mistake without trapping the agent. Generated code, vendored directories, files that must not change. Everything else is better reported after the write, which is what the other rules do.

## Commands

| Command | Does |
|---|---|
| `rulecast init` | Interactive setup |
| `rulecast install` / `uninstall` | Add or remove the agent hooks |
| `rulecast run` | Check staged files, changed files, or everything |
| `rulecast validate` | Check the config and print diagnostics |
| `rulecast doctor` | Compile, check the environment, dry-run every rule |
| `rulecast autoupdate` | Move pinned rule repos to their latest tag |
| `rulecast try-repo` | Run a rule repo against your project without configuring it |
| `rulecast clean` | Delete the cache |
| `rulecast warm` | Build detector caches ahead of time |
| `rulecast hook <adapter>` | Answer an agent hook on stdin |

`rulecast run` is also how you use rulecast in CI. `--from-ref main` checks only what a branch changed, which matters most for `llm` rules — they judge changed files only.

If something is configured but quiet, `rulecast doctor` says why: it compiles the config, reports whether each rule's linter, parser, script or API key is actually there, says where the hooks and caches live, and runs every rule against one file it matches.

## Agents

rulecast ships docs written for coding agents, not for people:

- [`agents/SETUP.md`](https://github.com/syv-ai/rulecast/blob/main/agents/SETUP.md) — give this to your agent and it will set rulecast up itself.
- [`agents/DRAFT-RULES.md`](https://github.com/syv-ai/rulecast/blob/main/agents/DRAFT-RULES.md) — it reads your `AGENTS.md`, proposes one rule per convention that code can visibly break, shows you what each would flag today, and asks you to keep, edit or drop it.

Claude Code is the supported agent today. Codex, Cursor and OpenCode are next; rulecast is agent-neutral by design, and only the adapter knows about a specific agent.

## Install

**npm — use this for agent hooks.**

```sh
pnpm add -D @syv-ai/rulecast     # or npm / yarn
npx @syv-ai/rulecast init
```

**Standalone binary — use this for CI and one-off runs.** Download it from [Releases](https://github.com/syv-ai/rulecast/releases). It needs no Node installation.

Prefer the npm install for hooks. The binary extracts and loads its embedded ast-grep parser on every run, which costs about 260 ms: a `rulecast run` that takes ~110 ms under Node takes ~370 ms as a binary (measured on an Apple M3 Pro). That is invisible in CI and too slow for a hook that fires on every file an agent writes.

Node ≥ 20.12. Linux and macOS; Windows is not supported.

## Performance

The edit hook is budgeted to finish in under 500 ms at p95 — measured from process start to exit, on a 30-rule project with warm caches, excluding `llm` rules. `pnpm perf` replays 50 edit events and checks it. The last measurement, on an Apple M3 Pro with all six detectors configured, was p50 170 ms and p95 187 ms.

The budget is what shapes the design: one detector run per kind per event, kinds in parallel, slow tools defaulted to `verify`, content-addressed caches on disk, no daemon. When an edit runs long, rulecast delivers what finished and builds the rest in the background rather than making the agent wait.

## Status

0.1. Everything above works and is tested. The config format may still change before 1.0 — `minimum_rulecast_version` exists so a rule can say what it needs.

Next: adapters for Codex, Cursor and OpenCode; Biome; rule tests (good and bad examples run by `rulecast test`); an Azure OpenAI provider.

## License

MIT — see [LICENSE](https://github.com/syv-ai/rulecast/blob/main/LICENSE).
