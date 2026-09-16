# rulecast — interactive `rulecast init`

**Status:** approved design, not yet planned
**Date:** 2026-09-16
**Depends on:** `2026-09-16-rulecast-pre-commit-format-design.md` (config file, rule repos, `install`, `validate`). Replaces `init` in `2026-09-15-rulecast-design.md` §12.

## 1. Goal

`rulecast init` sets a project up interactively, the way `npx skills add` or `gh skill install` do: detect the project, choose rules from the catalog, point them at the project's own docs, choose which agents get hooks, review every change, write. It ends by handing the developer a short prompt to paste into their coding agent for drafting project-specific rules.

`init` stays agent-neutral. Only adapter code knows about a specific agent.

## 2. Flow

```
$ npx @syv-ai/rulecast init
┌ rulecast init · ~/repos/aka-agents2
│ Detected  python (pyproject.toml) · typescript + react (frontend/)
│           AGENTS.md (imported by CLAUDE.md) · docs/ · Claude Code (.claude/)
│
◇ Rules from syv-ai/rulecast@v0.2.0
│ python   ◼ no-httpexception-in-services   ◼ services-layering
│ react    ◼ no-client-in-components        ◻ …
│ general  ◼ generated-code
│
◇ Conventions for the selected rules
│ no-httpexception-in-services  → AGENTS.md › Backend › Errors
│ no-client-in-components       → package doc
│
◇ Install hooks for   ◼ Claude Code   ◻ Cursor (not supported yet)
◇ Claude Code hooks in   ● shared (.claude/settings.json)   ○ personal (.claude/settings.local.json)
│
◇ Review
│ .rulecast-config.yaml   new, 1 repo, 3 rules
│ .claude/settings.json   +6 hooks
│ Write?  Yes
│
◇ Installed. rulecast validate: 3 rules valid.
│
◇ Draft rules for your own conventions. Paste this into your coding agent:
│
│   Read https://raw.githubusercontent.com/syv-ai/rulecast/v0.2.0/agents/DRAFT-RULES.md
│   and follow it to draft rulecast rules for this project from AGENTS.md.
│
◇ Copy to clipboard?  Yes
└ Copied. Commit .rulecast-config.yaml and .claude/settings.json.
```

Steps, in order:

1. **Detect** (§3). Print a one-line summary.
2. **Catalog.** Fetch the latest tag of the rulecast repo into the cache and read its manifest. Multi-select rules grouped by package prefix, with `name` and `description`. Preselected: rules that apply to at least one file from `git ls-files --cached --others --exclude-standard`, using the rule's own `files`/`exclude`/`types`. Rules already in the config are shown as installed and cannot be deselected. If the fetch fails (offline, repository unreachable), the step is skipped with a warning and `init` continues without catalog rules.
3. **Conventions.** For each selected rule that has `context`: keep the package's doc (default) or choose a heading from the detected docs, listed as `file › heading › subheading`. A choice writes `context: ["@<file>#<anchor>"]` as an override.
4. **Agents.** Multi-select from detected agents. Agents with an adapter are selectable and preselected when detected; detected agents without one are shown disabled as "not supported yet". For each selected adapter, choose its scope (shared or personal) from the adapter's own settings locations.
5. **Review.** List every file `init` will create or change, with a summary. Nothing is written before confirmation.
6. **Write.** Write or update `.rulecast-config.yaml`, run `install` for the selected agents, run `validate`, report the result.
7. **Drafting prompt.** Show the prompt (§5) and offer to copy it.

Re-running `init` on a configured project only adds: new rules are appended to the right repo entry, overrides are added only for newly selected rules, existing rules and overrides are never changed or removed.

Cancelling at any prompt (Ctrl+C) exits 130 without writing anything.

## 3. Detection

All detection is a default the developer can change.

- **Stack:** file-type tags present in `git ls-files` (the same extension table as rule `types`), plus markers: `pyproject.toml`/`requirements*.txt` → python, `package.json` with a `react` dependency → react. Used only for the summary; preselection comes from rule filters.
- **Docs:**
  - `AGENTS.md` at the root and in subdirectories, first.
  - `CLAUDE.md` files: one that imports `@AGENTS.md` is treated as the same document and not listed separately; one without that import is listed as a doc of its own.
  - Other tracked markdown files, excluding `README*`, `CHANGELOG*`, `LICENSE*` and anything under `node_modules/`.
  - Headings are read with the same scanner as reference anchors.
- **Agents:** each adapter declares its detection markers (Claude Code: `.claude/` or `CLAUDE.md`). A small table of known agents without adapters (Cursor: `.cursor/`; Codex: `.codex/`) supplies the disabled entries.

## 4. Non-interactive use

```
rulecast init [--rules id,id | --no-rules] [--agent <name>]... [--scope shared|personal] [--yes]
```

- Any choice without a flag takes the detected default (§2 preselection, package docs, detected adapters, shared scope).
- `--yes` skips the Review confirmation and the clipboard question.
- Without a TTY and without `--yes`, `init` prints the planned changes and exits 2 with a hint to rerun with `--yes`.
- In non-interactive runs the drafting prompt is printed, never copied.

## 5. Drafting prompt and agent docs

`init` does not start or configure an agent. It prints a prompt of this form, with the detected doc filled in (`AGENTS.md`, a standalone `CLAUDE.md`, or "the project's docs" when none were found) and the tag matching the catalog `rev`:

```
Read https://raw.githubusercontent.com/syv-ai/rulecast/<tag>/agents/DRAFT-RULES.md
and follow it to draft rulecast rules for this project from <doc>.
```

**Clipboard:** `pbcopy` (macOS), `wl-copy` or `xclip -selection clipboard` (Linux), `clip.exe` (Windows/WSL), whichever exists first. None available: print only.

**Agent docs** live in the rulecast repo under `agents/`, versioned by tag, written like skills (short, task-focused, references loaded on demand):

| File | Content |
|---|---|
| `agents/SETUP.md` | For agents asked to set rulecast up without the developer running `init`: run `npx @syv-ai/rulecast init --yes`, show the developer the resulting config, then continue with `DRAFT-RULES.md` |
| `agents/DRAFT-RULES.md` | Drafting procedure: read the named doc and the code it describes; propose conventions that can be checked mechanically (prefer `path`, `regex`, `ast-grep`; `llm` only when nothing else expresses it); for each, show the rule, add it under `repo: local`, run `rulecast validate` and `rulecast run <id> --all-files --format json`, report existing matches, and ask the developer to keep, edit or drop it (removing dropped rules); conventions that cannot be checked become `stages: [touch]` rules pointing at their section; never change repo rules, overrides or code |
| `agents/reference/rule-format.md` | The rule and config keys (format spec §2–§3) |
| `agents/reference/detectors.md` | Each detector's config, captures and default stages |

The raw GitHub links require the repository to be public; publishing it is a prerequisite for releasing `init`.

## 6. Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/init/detect.ts` | Stack, docs (with headings) and agents from a project root. Pure over the file list and file reads | file matching, anchors scanner, adapter detection markers |
| `src/init/plan.ts` | Selections → planned file changes (config text, per-adapter settings changes). Pure | config schema and writer, adapters' install planning |
| `src/init/prompts.ts` | The only TTY layer, on `@clack/prompts`. Takes a `Prompter` interface so tests inject scripted answers | `@clack/prompts` |
| `src/init/clipboard.ts` | Finds a clipboard command and copies text | `node:child_process` |
| `src/init/draft-prompt.ts` | Builds the drafting prompt from detected doc and tag | none |
| `src/commands/init.ts` | Orchestrates: detect → catalog → prompts or flags → plan → review → write via `install` → `validate` → drafting prompt | the units above, repos cache, `install`, `validate` |
| Adapter additions | Each adapter declares `detect` markers and its settings scopes, and plans its hook install as a change (so Review can show it) | none |

Config updates preserve existing comments and formatting (the same YAML document handling as `autoupdate`).

## 7. Testing

- **detect:** fixture projects for each doc case (AGENTS.md only; CLAUDE.md importing AGENTS.md; standalone CLAUDE.md; docs in `docs/` and `ways-of-working/`; nested AGENTS.md), stacks, agents with and without adapters.
- **plan:** selections to exact file contents, including re-running on an existing config with comments and overrides.
- **init end to end:** `--yes` in a fixture repo against a local bare git "rulecast repo"; scripted `Prompter` answers covering deselection, doc overrides, personal scope and cancellation; no-TTY without `--yes` exits 2 without writing.
- **clipboard:** command selection with a stubbed `PATH`.
- **draft prompt:** snapshot per detected doc case.
- **agent docs:** every URL the prompt can produce, and every link inside `agents/`, exists at that path in the repository.
- **Manual smoke test:** run `init` interactively in a scratch project, paste the prompt into an agent, and confirm it drafts, checks and asks about at least one rule.

## 8. Out of scope

- Starting, configuring or injecting into a coding agent.
- Adapters other than Claude Code.
- Choosing rule repos other than the rulecast repo in the interactive catalog (they can be added to the config by hand).
