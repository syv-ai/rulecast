<!-- Generated from the repository README by `pnpm readme`. Do not edit by hand. -->

# rulecast

**Documentation: [syv-ai.github.io/rulecast](https://syv-ai.github.io/rulecast/)**

Your project's conventions are written down in `AGENTS.md` or `CLAUDE.md`, and your coding agent read them once, forty tool calls ago. rulecast delivers them again at the moment they matter: when the agent is about to break one.

A rule pairs a check with a message and a pointer to the doc section it enforces. rulecast runs as an agent hook, so when the agent changes a file that breaks a rule — with its edit tools or with Bash — it gets told, in the same turn, before it moves on.

```
rulecast: 1 rule violated in app/services/users.py

error backend/no-httpexception
  app/services/users.py:2 raises HTTPException(404) in the service layer. Raise a domain exception; the API layer maps it to a response.

--- conventions/backend.md#errors ---
## Errors

Services raise domain exceptions. `app/api/errors.py` maps each one to a status code.
```

That is real output. The agent sees the finding *and* the paragraph of your documentation that explains it, without having to go looking.

A file the agent rewrites with `sed -i` or a script is checked like one it changes with `Edit`: rulecast compares the working tree before and after each Bash call. A change no call explains — your own editor, a formatter, a job the agent left running — is reported when the agent stops, and never blocks it.

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
        message: "{{file}}:{{line}} raises HTTPException({{args}}) in the service layer. Raise a domain exception; the API layer maps it to a response."
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
| `command` | Whatever a tool or your own script reports: SARIF, JSON, checkstyle, code-quality JSON or `file:line:` lines. Type checkers, dead-code finders and scanners [by config](https://github.com/syv-ai/rulecast/blob/main/agents/reference/tool-recipes.md) | every edit (whole-project tools: verify) |
| `hook` | A hook your `.pre-commit-config.yaml` or `lefthook.yml` already declares | verify |
| `linter` | ruff, oxlint, eslint or gitleaks findings, narrowed to the rules you care about | edit (eslint: verify) |
| `llm` | Conventions nothing mechanical expresses, judged by a model | verify only |

`llm` rules are opt-in, name their own model, and by default run only when the agent stops, not on every edit, and so do `hook` rules and whole-project tools. A rule can ask for the edit hook with `stages: [edit, verify]`. Everything else is fast enough to run on every file the agent writes. See [`agents/reference/detectors.md`](https://github.com/syv-ai/rulecast/blob/main/agents/reference/detectors.md).

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

That covers the edit tools. A write through Bash cannot be refused before it runs, because nothing knows what a command will write, so rulecast catches it right after: the agent is told the file is protected and how to revert it, it cannot stop until it has, and you are told which file it changed.

## Commands

| Command | Does |
|---|---|
| `rulecast init` | Set rulecast up: config, catalog rules, your existing git hooks as rules, agent hooks |
| `rulecast install` / `uninstall` | Add (or upgrade) or remove the agent hooks |
| `rulecast run` | Check staged files (the default), changed files, or everything |
| `rulecast baseline` | Record today's findings, so full-repo runs fail only on new ones |
| `rulecast fix` | Apply regex and ast-grep rules' fixes; `--dry-run` prints the diff |
| `rulecast list` | Show every configured rule: where it comes from, what it matches, what it cites |
| `rulecast test` | Run each rule's good/bad examples; `--against` says how much it would flag |
| `rulecast stats` | Per-rule outcomes from agent sessions: fired, fixed, ignored, noisy |
| `rulecast validate` | Check the config (and a rules manifest) and print diagnostics |
| `rulecast doctor` | Compile, check the environment and hooks, dry-run every rule; `--ci` fails on a setup that would run degraded |
| `rulecast autoupdate` | Move pinned rule repos to their latest tag |
| `rulecast try-repo` | Run a rule repo against your project without configuring it |
| `rulecast clean` | Delete the cache |
| `rulecast warm` | Build detector caches ahead of time |
| `rulecast hook <adapter>` | Answer an agent hook on stdin (the agent runs this, not you) |

`rulecast <command> --help` prints a command's flags; `rulecast --version` prints the version.

### Exit codes

`rulecast run`, `rulecast try-repo` and `rulecast fix` (after its fixes) exit with:

| Code | Meaning |
|---|---|
| `0` | Every rule ran; no new error-severity findings (warnings and pre-existing findings allowed) |
| `1` | Every rule ran; at least one new error-severity finding |
| `2` | rulecast could not run: usage, a config file that does not load, git, or an internal error |
| `3` | Incomplete: a rule failed to compile, a rule repo could not be fetched, a detector failed or timed out. Findings that were produced are still reported. Wins over 1 |

On `2` nothing is printed to stdout. `try-repo` also exits `2` when the repo it tries cannot be fetched. Other commands use `2` for the problems they find. `--format json` and `--format sarif` are a stable contract, with an id per finding that survives code moving around: see [`agents/reference/output.md`](https://github.com/syv-ai/rulecast/blob/main/agents/reference/output.md).

## Git hooks and CI

The same rule reports the same line the same way in an agent hook, a git hook and CI. What counts as new is a match on a line you changed; a violation that was already there is backlog, shown and never failing.

- **Pre-commit:** `rulecast run` with no file flags checks the staged files, reads their content from the index (what is being committed, not the working tree), and judges it against `HEAD`. `llm` rules are skipped unless you pass `--llm`, and one line says so: a commit should not cost money.
- **Pre-push and CI:** `rulecast run --from-ref A --to-ref B` checks the files changed between the merge base with `A` and `B`, reading them at `B`. Without `--to-ref` it reads the working tree.
- `rulecast run --files F...` and `--all-files` judge files whole: against a committed `.rulecast/baseline.json` when there is one, else with no baseline. Use the hook below rather than `--files` from a hook manager.
- **A nightly sweep or a scheduled agent loop** over the whole repository has no ref to diff against: commit a baseline once, and `rulecast run --all-files` exits 0 unless something got worse. Recipes for `/goal`, `/loop` and scheduled sweeps: [`agents/reference/loops.md`](https://github.com/syv-ai/rulecast/blob/main/agents/reference/loops.md).

rulecast installs no git hooks itself: lefthook, husky and pre-commit already own `.git/hooks`. Add `@syv-ai/rulecast` to the project's devDependencies (the agent hooks need it there anyway), and wire it into the one you use.

**pre-commit** (`.pre-commit-config.yaml`):

```yaml
minimum_pre_commit_version: "3.2.0"
repos:
  - repo: https://github.com/syv-ai/rulecast
    rev: v0.4.0
    hooks:
      - id: rulecast
      - id: rulecast-push
```

**lefthook** (`lefthook.yml`):

```yaml
pre-commit:
  jobs:
    - name: rulecast
      run: npx --no-install rulecast run
pre-push:
  jobs:
    - name: rulecast
      run: npx --no-install rulecast run --from-ref "$(git merge-base origin/HEAD HEAD)" --to-ref HEAD
```

**GitHub Actions:**

```yaml
on: pull_request
jobs:
  rulecast:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # rulecast needs the merge base with the target branch
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx rulecast run --from-ref origin/${{ github.base_ref }} --format sarif > rulecast.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always() # rulecast exits 1 on findings and 3 when a rule could not run, which is when the upload matters
        with:
          sarif_file: rulecast.sarif
```

A shallow clone has no merge base; rulecast says so and names `fetch-depth: 0`. `--from-ref` runs `llm` rules, which judge changed files only.

`command` scripts, and `oxlint`, are handed a scratch copy of each file in staged and `--to-ref` runs, because the content to judge is not the file on disk. `ruff` and `eslint` get it on stdin under the real path, so path-keyed configuration still applies. Whole-project tools (`scope: project`, `hook` rules) need the real project: they run on the working tree when the rule's files there match what is being committed, and are skipped with a warning naming the files when they don't. rulecast never stashes.

### Fresh environments

A CI job, a cloud agent session or a new container starts with nothing installed. rulecast does not fail quietly there: in unattended mode every stop says which rules did not run and why ("2 rules disabled: …: not in the cache"), and the agent is held once per prompt to put that in its final report. `rulecast run` says `incomplete` and lists them under `disabled` in JSON. To have nothing to report:

1. Install dependencies (`npm ci` or `pnpm install`) before the agent starts. Without them the agent hooks do nothing, and in unattended mode every stop says so.
2. Run `npx rulecast install`. It fetches the pinned rule repos; hooks never fetch.
3. Run `npx rulecast doctor --ci` before the agent step. It reads the cache as the hooks do and fetches nothing. It exits 2 if a rule repo is missing from the cache, a rule's tool is not installed, or the hooks cannot run (a committed hook command runs only `node_modules/.bin/rulecast`, so a global or `npx` rulecast does not count). Add `--from-ref origin/main` when the job also runs `rulecast run --from-ref`.
4. Check out with `fetch-depth: 0` if you use `--from-ref`.
5. Under `CI` or `GITHUB_ACTIONS` unattended mode is on by itself. Elsewhere set `RULECAST_MODE=unattended`. The hook command's not-installed guard reads only the environment, never the config's `mode:`.
6. End the loop with `rulecast run --from-ref …`. It is the gate that counts, and a non-zero exit with `incomplete` means some rules did not run.
7. Optionally cache `~/.cache/rulecast/repos` between jobs (for example `actions/cache` keyed on `.rulecast-config.yaml`). It saves a clone per job.

A new git worktree on the same machine needs none of this beyond step 1. Rule repos are cached per user, not per checkout, and nothing on the edit path reads a per-project cache ([Performance](#performance)). `rulecast warm` only matters for plugin detectors that warm, and SessionStart starts it for you.

## Turning a rule off

- **A whole rule:** `enabled: false` on the rule. Under a rule repo's entry, `- id: <rule>` with `enabled: false` switches a catalog rule off and keeps the line.
- **One finding:** a comment on the matched line or the line above it, in the file's own comment syntax. The reason is required; an ignore without one suppresses nothing.

  ```python
  # rulecast-ignore: python/no-httpexception-in-services legacy endpoint, removed in #412
  raise HTTPException(404)
  ```

`rulecast run --all-files --summary` counts the ignores, and an ignore or a config change made during an agent session is reported to you when the agent stops: the agent cannot quietly edit its way past a rule.

## Adopting a rule on a codebase that already breaks it

`rulecast run --all-files --summary` tells you how much you already owe:

```text
backlog: 57 violations in 31 files

  rule                            violations  files
  python/routes-never-call-crud           57     31

  worst files                     violations
  app/api/routes/orders.py                12
  app/api/routes/users.py                  9
```

Watch the count, not the rate. Here is one real codebase on one rule, on `main`:

| date | violating / total |
|---|---|
| 2026-01-15 | 61 / 80 |
| 2026-06-01 | 58 / 143 |
| 2026-09-25 | 57 / 194 |

The rate fell from 76% to 29% and the count did not move. New code complied; the old violations were
never fixed, only diluted. A team watching the percentage would have believed it was winning.

Per-edit enforcement does not touch that stock — it only stops it growing. Fix it a file at a time:
edits to files that already followed the rule broke it 2% of the time, against 37% in files that
mostly did not, so a file you clean tends to stay clean. (One rule across 19 files: suggestive, not
proven.)

When the fix is mechanical, give the rule a [`fix`](https://github.com/syv-ai/rulecast/blob/main/agents/reference/rule-format.md#fixes) and burn the stock down in one go: `rulecast fix <rule> --all-files --dry-run` shows the diff, and without `--dry-run` it writes it. Hooks never apply a fix; only that command does.

### A committed baseline

`--from-ref` needs a ref. A scheduled full-repository run, such as a nightly convention sweep or an agent loop told to keep `main` clean, has none, so every legacy violation is new and the run always fails. For those, record what is there today:

```sh
rulecast baseline            # writes .rulecast/baseline.json
git add .rulecast/baseline.json && git commit -m "rulecast baseline"
rulecast run --all-files     # exits 0 unless something got worse
```

- `run --all-files` and `run --files` treat the findings listed in the file as pre-existing, and fail only on new ones. Sessions, `--from-ref` and staged commits keep their own baseline, and hooks never read the file.
- The file lists finding ids ([what an id is](https://github.com/syv-ai/rulecast/blob/main/agents/reference/output.md#finding-ids)), so editing a baselined line's offending text, or moving its file, makes the finding new.
- When a run no longer finds an entry it says so: `baseline: 3 entries no longer found (fixed or changed); rulecast baseline --prune drops them`. Run `--prune` in the same pull request that fixes them. It only ever removes entries, never adds one, and keeps the entries of rules that did not run.
- Recording new findings means rewriting the file with `rulecast baseline --force`. That is an amnesty, and it shows in review as one.
- `rulecast doctor` reports its size, when it was added and when it last changed.
- `llm` rules are included unless you pass `--no-llm`. A model's matches can drift between runs, so expect those entries to churn.

Where a ref exists, `--from-ref` is the better baseline: it never needs maintaining and never turns into an amnesty file.

If something is configured but quiet, `rulecast doctor` says why: it compiles the config, reports whether each rule's linter, parser, script or API key is actually there, says where the hooks and caches live, and runs every rule against one file it matches.

## Agents

rulecast ships docs written for coding agents, not for people. Paste this to yours and it will set
rulecast up itself:

```text
Set up rulecast in this project. Read
https://syv-ai.github.io/rulecast/agents/SETUP.md
and follow it. Show me every file it creates or changes before I commit anything.
```

If your agent cannot fetch a URL, this is the whole of it: run
`npx @syv-ai/rulecast init --yes --agent <your agent, e.g. claude-code>`, then show me
`.rulecast-config.yaml` and the other files it listed. Never edit hook settings by hand —
`rulecast install` and `rulecast uninstall` own them.

Once it is set up, ask the same agent to draft rules for your own conventions; `init` prints the
prompt to paste.

- [`agents/SETUP.md`](https://github.com/syv-ai/rulecast/blob/main/agents/SETUP.md) — give this to your agent and it will set rulecast up itself.
- [`agents/DRAFT-RULES.md`](https://github.com/syv-ai/rulecast/blob/main/agents/DRAFT-RULES.md) — it reads your `AGENTS.md`, proposes one rule per convention that code can visibly break, shows you what each would flag today, and asks you to keep, edit or drop it.

With subagents, each one's stop checks only the files it edited, so it is never asked to fix
another agent's code. The main agent's stop checks everything the session changed: a problem that
only shows when two subagents' changes meet is caught there. A file two subagents both edit can
block either of them. A change no agent's tool call made, such as your own edit, is reported at the
main agent's stop, and at a subagent's only when that subagent's own shell calls came across it.

When agents run in parallel in one working tree and one of them changes files with the shell, it
can be blamed for what the others wrote while its command ran, with any tool. For parallel agents,
give each its own worktree (in Claude Code, a subagent with `isolation: worktree`).

If your agent runs with nobody watching, such as Claude Code's `/goal`, `claude -p` or a scheduled task, add the `loop-safety` catalog pack: `npx @syv-ai/rulecast init --rules loop-safety`. It catches the shortcuts a loop takes to make tests pass: skipped or focused tests, new lint and type suppressions, changed coverage thresholds, and edits to CI or rulecast's own config. See [`packages/rules-loop-safety/loop-safety.md`](https://github.com/syv-ai/rulecast/blob/main/packages/rules-loop-safety/loop-safety.md). [`agents/reference/loops.md`](https://github.com/syv-ai/rulecast/blob/main/agents/reference/loops.md) has recipes for `/goal`, `/loop`, scheduled sweeps and learning from `rulecast stats`.

As the hooks run, rulecast keeps a local log of the findings it reported — finding ids, rule ids, files and lines, never code — so `rulecast stats` can show which rules the agent fixes, which it keeps hitting or silencing, and which never fire. `rulecast clean` deletes it.

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

The hook before every Bash call only records the working tree: it is held to 150 ms over a hook that does nothing, and adds 135–150 ms at p95 on a 20,000-file repository (`microsoft/vscode`), nearly all of it git finding untracked files. The hook after a Bash call that changed a file is an edit event, under the same 500 ms budget.

A new worktree's first edit hook took p50 477 ms and p95 490 ms, against 252 ms for a warm edit in the same project (10 worktrees, report only). A new session in an existing checkout costs nothing extra (253 ms), and neither does an empty per-project detector cache (477 ms). The fixture pins no rule repos, so this says nothing about a missing one: hooks never fetch, and its rules do not run until `rulecast install` (see [Fresh environments](#fresh-environments)). The difference is macOS checking each executable the first time it runs from a new path: the project's own `command` script and the `node_modules/.bin` linter shim each took about 200 ms on their first run and 10–60 ms after that. Run them once beforehand and the first edit costs the same as a warm one. SessionStart in a new worktree takes 174 ms. A worktree needs no preparation.

The budget is what shapes the design: one detector run per kind per event, kinds in parallel, slow tools defaulted to `verify`, content-addressed caches on disk, no daemon. When an edit runs long, rulecast delivers what finished and builds the rest in the background rather than making the agent wait.

## Status

0.4. Everything above works and is tested. Before 1.0 the config format and the output of `rulecast run` may still change; `minimum_rulecast_version` exists so a rule can say what it needs.

Next: adapters for Codex, Cursor and OpenCode; Biome; an Azure OpenAI provider.

## License

MIT — see [LICENSE](https://github.com/syv-ai/rulecast/blob/main/LICENSE).
