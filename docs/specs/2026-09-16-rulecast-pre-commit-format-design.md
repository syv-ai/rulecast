# rulecast — pre-commit-style config, rule repos and commands

**Status:** approved; folded into `2026-09-15-rulecast-design.md` on 2026-09-16, which is authoritative. Kept as the design record.
**Date:** 2026-09-16
**Amends:** `2026-09-15-rulecast-design.md` §4 (rule format and project config), §5 (compilation inputs), §7 (triggers), §9 (storage location), §12 (CLI), §16 (package layout). Everything not named here is unchanged.

## 1. Why

Developers already know how pre-commit hooks are configured: one root file, a list of hooks pulled from pinned repos, per-hook `files`/`exclude`/`types`/`stages`, keys that can be overridden. rulecast adopts that shape so rules and configs read as familiar, and so shared rules can be published, pinned and updated the way pre-commit hooks are.

What stays rulecast's own is what a rule contains: a detector, a message, context references and a severity. rulecast does not run arbitrary executables in managed environments; tools such as mypy, ruff or eslint run through the `linter` and `command` detectors, resolved from the project's own toolchain.

## 2. Project config: `.rulecast-config.yaml`

One file at the project root replaces `.rulecast/config.yml` and `.rulecast/rules/**`. The project root is the nearest ancestor directory containing `.rulecast-config.yaml`. Keys are snake_case.

```yaml
minimum_rulecast_version: 0.2.0
files: ""                               # global include regex (default: everything)
exclude: ^vendor/                       # global exclude regex (default: ^$)
default_stages: [edit, verify]

context: { mode: inject, max_bytes: 32768 }
max_matches_per_rule: 10
timeouts: { edit_deadline_ms: 350, verify_ms: 60000 }
stop_gate: { max_blocks: 1 }
llm: { provider: anthropic, model: claude-haiku-4-5-20251001, base_url: null, api_key_env: ANTHROPIC_API_KEY, max_files_per_verify: 10 }

repos:
  - repo: https://github.com/syv-ai/rulecast
    rev: v0.2.0
    rules:
      - id: python/no-httpexception-in-services
        files: ^app/services/
        context: ["@AGENTS.md#errors"]
      - id: generated-code
        alias: generated-client
        files: ^frontend/src/client/
  - repo: local
    rules:
      - id: api/no-client-in-components
        name: Components never call the API client
        files: ^frontend/src/components/
        types: [tsx]
        exclude: \.test\.tsx$
        detect:
          ast-grep: { language: tsx, rule: { pattern: 'import { $$$NAMES } from "@/client"' } }
        message: "{{file}}:{{line}} imports {{NAMES}} from the generated client. Use the feature's query hook."
        context: ["@docs/api-access.md#frontend-data-flow"]
      - id: services-conventions
        name: Service layer conventions
        files: ^app/services/
        stages: [touch]
        context: ["@AGENTS.md#services"]
```

### Top-level keys

| Key | Default | Meaning |
|---|---|---|
| `repos` | required | List of repo entries (§3) |
| `minimum_rulecast_version` | none | Compile diagnostic when the running rulecast is older |
| `files`, `exclude` | `""`, `^$` | Global regexes applied before every rule's own |
| `default_stages` | none | Stages for rules without `stages`; otherwise the detector's defaults |
| `context`, `max_matches_per_rule`, `timeouts`, `stop_gate`, `llm` | as in the main spec §4 | Same settings, snake_case |

### Repo entries

- `repo`: a git URL, or `local` for rules defined inline.
- `rev`: required for URLs, forbidden for `local`. A tag or full commit SHA; a branch name is a `validate` warning, as in pre-commit.
- `rules`: list of rule entries. For a URL repo, each entry selects a rule from the repo's manifest by `id` and may override any key except `id`. For `local`, each entry is a complete rule.

The only key renamed from pre-commit is `hooks:` → `rules:`.

## 3. Rules

### Keys

| Key | Origin | Meaning |
|---|---|---|
| `id` | pre-commit | Required. `[a-z0-9-]+(/[a-z0-9-]+)*`. Unique within a repo |
| `alias` | pre-commit | Second name, so the same rule can be selected twice with different overrides. Unique across the config; findings and dedupe use `alias` when set |
| `name` | pre-commit | Required for `local` rules and in manifests |
| `description` | pre-commit | Optional text for catalogs and `init` |
| `files`, `exclude` | pre-commit | Regexes searched (not anchored) in the repo-relative path with forward slashes. Defaults `""` and `^$` |
| `types`, `types_or`, `exclude_types` | pre-commit | File-type tags from a built-in extension table (`python`, `ts`, `tsx`, `javascript`, `jsx`, `markdown`, `yaml`, `json`, …). All of `types` must match, at least one of `types_or`, none of `exclude_types`. Default `types: [file]` |
| `stages` | pre-commit | Subset of `touch`, `edit`, `verify` (§3.2) |
| `minimum_rulecast_version` | pre-commit | Per rule, for manifests |
| `severity` | rulecast | `error` (default) or `warning` |
| `detect` | rulecast | One detector and its config. Required unless `stages` is `[touch]` |
| `message` | rulecast | Template; required with `detect` |
| `context` | rulecast | Ordered references (§3.3) |

Not carried over from pre-commit: `entry`, `language`, `language_version`, `additional_dependencies`, `args`, `pass_filenames`, `require_serial`, `always_run`, `fail_fast`, `verbose`, `log_file`.

A rule applies to a file when the global and rule `files`/`exclude` match and the type keys match.

### Stages

`stages` replaces the main spec's `on` and `events`:

- `touch`: the first time in an agent context that the agent reads or edits a matching file, the rule's context is delivered with no message.
- `edit`, `verify`: the detector runs on that event.

Defaults, in order: the rule's `stages`, the config's `default_stages`, then `[touch]` for rules without `detect` or the detector's `events(config)` for rules with one. A rule with `stages: [touch]` and a `detect` is a compile diagnostic (the detector would never run).

### Context references

A reference is `@` plus a path relative to a root, optionally `#anchor`, with an optional `mode` exactly as in the main spec. No folder name is implied; `@AGENTS.md#errors`, `@docs/api.md` and `@ways-of-working/backend.md` are equally valid.

The root depends on where the reference is written:

- in the project config (a `local` rule, or an override of a repo rule's `context`): the project root;
- in a manifest: the rule repo's root in the cache.

Rendering and dedupe identify a reference by its source as well as its path. References from a rule repo are labelled `<owner>/<repo>@<rev>:<path>[#anchor]`; a `read`-mode reference from a rule repo gives the agent the absolute path of the fetched file.

### Overrides

A config entry for a repo rule is merged over the manifest rule key by key (shallow: an overridden `detect` or `context` replaces the manifest's value). Overridden `@` paths resolve against the project root (§3.3).

## 4. Rule repos

### Manifest: `.rulecast-rules.yaml`

At a rule repo's root: a list of complete rules (§3). A manifest rule is the default for any project that selects it.

### The rulecast monorepo

```
packages/rulecast/            the CLI, published to npm as @syv-ai/rulecast
packages/rules-python/        rules.yaml and the docs its rules reference (any folder names)
packages/rules-react/
agents/                        agent-facing docs (interactive init spec)
.rulecast-rules.yaml           generated
```

A script generates the root manifest from `packages/rules-*/rules.yaml`: ids get the package prefix (`rules-python` → `python/`), `@` paths are rewritten relative to the repo root. CI fails when the committed manifest is stale and runs `rulecast validate` on it. One tag versions the CLI and every rule package together.

### Fetching

- A repo is fetched once per `rev` into the cache (§6): a shallow git fetch of that rev into a temporary directory, renamed into place, under a per-repo lock. A partially fetched repo is never read.
- `install`, `run`, `try-repo` and `validate` fetch repos that are missing from the cache.
- **Agent hooks never fetch.** A missing repo disables its rules for the session with one warning: `run rulecast install`.

### Errors

Compile diagnostics, shared by hooks and CLI, each naming the repo and rev and disabling only the affected rules:

- config `id` not in the repo's manifest;
- manifest missing, unparseable or failing its schema;
- `minimum_rulecast_version` (config or rule) newer than the running rulecast;
- `rev` missing for a URL repo, or present for `local`;
- duplicate `id` within a repo or duplicate `alias` in the config.

## 5. Commands

| Command | Does |
|---|---|
| `rulecast init` | Interactive setup (interactive init spec) |
| `rulecast install [--agent <name>]` | Installs agent hooks (merged, never modifying existing entries) and fetches missing repos |
| `rulecast uninstall [--agent <name>]` | Removes only the hook entries rulecast added |
| `rulecast run [RULE_ID] [--all-files \| --files F…] [--from-ref A --to-ref B] [--format terminal\|agent\|json\|sarif] [--session <id>] [--no-llm]` | Verify event. Replaces `check` |
| `rulecast autoupdate [--freeze] [--repo URL]` | Moves each URL repo's `rev` to its latest tag, preserving comments and formatting. `--freeze` writes the commit SHA with a `# frozen: <tag>` comment |
| `rulecast try-repo <path\|url> [RULE_ID] [run flags]` | Runs a repo's rules (all, or one) against the project without editing the config. For rule authors |
| `rulecast validate [file…]` | Validates `.rulecast-config.yaml` as a config and `.rulecast-rules.yaml` as a manifest, by filename. With no arguments, whichever exist at the root. Exit 2 on diagnostics |
| `rulecast clean [--project]` | Deletes the cache, or only the current project's directory |
| `rulecast hook <adapter>`, `rulecast warm`, `rulecast doctor` | As in the main spec |

`check` is removed, not aliased, and `validate` now covers both files (no users at 0.0.0).

**`run` file selection:**

- explicit `--files`;
- `--from-ref A --to-ref B`: files changed between the merge base of A and B and B; the merge base is the baseline;
- `--all-files`: every file from `git ls-files --cached --others --exclude-standard` (tracked plus untracked, not ignored);
- otherwise: staged files, as pre-commit does.

Exit codes are unchanged: 0 no new error findings, 1 new error findings, 2 rulecast failed.

## 6. Cache and state

```
$RULECAST_HOME | $XDG_CACHE_HOME/rulecast | ~/.cache/rulecast
  repos/<host>_<owner>_<repo>/<rev>/
  projects/<first 16 hex of sha256(realpath(project root))>/
    root                         the project path, for doctor and clean
    sessions/<session-id>/...    stores and lock, unchanged
    cache/<detector kind>/...
    warm/<kind>/.lock
    debug.log
```

- Nothing rulecast writes lives in the project: no `.rulecast/` directory, no `.gitignore` entry.
- Separate checkouts and worktrees of one repo get separate project directories.
- `doctor` prints the cache root and the project directory.

## 7. Testing

- **Config and manifest schemas:** every key, defaults, the diagnostics in §4, snake_case only.
- **Merge and resolution:** overrides replace keys shallowly; `@` paths resolve per §3.3; aliases select the same rule twice.
- **File matching:** regex semantics, global and rule filters, `types`/`types_or`/`exclude_types` against the extension table.
- **Stages:** defaults in order, the `[touch]`-with-`detect` diagnostic.
- **Repos:** fetching from a local bare git repository used as the remote (no network in tests), atomic rename, concurrent fetches under the lock, hooks with a missing repo.
- **Monorepo manifest generator:** prefixes, path rewriting, staleness check.
- **Commands:** `run` file selection for each mode, `autoupdate` preserving comments and `--freeze`, `validate` by filename, `clean`, `install`/`uninstall` round trip.
- **Cache home:** env precedence, project hashing.
- Existing pipeline, session and adapter tests keep passing against configs converted to the new format.

## 8. Out of scope

- Managed tool environments (`language`, `additional_dependencies`), running pre-commit hook repos, `meta` repos.
- `gc`, `migrate-config`, `init-templatedir`, installing rulecast as a git hook.
- Independent versioning of rule packages.
