# rulecast's conventions

The conventions code in this repository is held to, each with the reason. They assume the worst of
whoever is writing: every shortcut the code allows will be taken by someone, usually an agent at the
end of a long turn, and most of these were taken at least once — the commit that undid it is cited.

The specification (`docs/specs/2026-09-15-rulecast-design.md`) is authoritative on behaviour. This
file exists so rules have something stable to point at: a plan records one change, and a rule's
reference should outlive it. One `##` per convention, so each has its own anchor. Paths are relative
to `packages/rulecast/` unless they start at the repository root.

`.rulecast-config.yaml` turns these into rules. A convention whose break is visible in one file has
a pattern rule; the rest are delivered by a touch rule on the area they bind.

**Areas:** [process and layers](#only-clits-touches-the-process) ·
[detectors](#guarding-detectors-read-only-through-read) ·
[subprocesses and git](#spawn-with-an-argument-array-never-a-shell) ·
[paths](#repo-relative-paths-use-forward-slashes) ·
[errors](#narrow-every-catch) ·
[state and stores](#no-module-level-mutable-state) ·
[delivery](#the-renderer-prices-its-own-output-a-line-at-a-time) ·
[data and types](#validate-external-input-with-safeparse) ·
[rule format](#a-rule-key-is-four-changes-not-one) ·
[adapters](#adapter-parse-returns-null-never-throws) ·
[tests](#tests-never-reach-the-network) ·
[catalog, docs and release](#catalog-rule-ids-carry-no-package-prefix)

---

## Only cli.ts touches the process

`src/cli.ts` is the composition root and the only file in `src/` that touches `process`: it builds a
`CliIo` (`cwd`, `env`, `stdout`, `stderr`, `readStdin`) and hands it to `commands/main.ts`. Nothing
else calls `console.*`, writes to `process.stdout` or `process.stderr`, reads `process.argv`, or sets
`process.exitCode`. Commands print through `io.stdout` and `io.stderr`, the core returns data, and
adapters return `{ stdout, exitCode }`.

A hook's stdout is parsed as JSON by the agent (`adapters/claude-code/adapter.ts`). One stray
`console.log` left from debugging corrupts every event's answer, and the agent silently ignores the
hook. Command tests drive `main(argv, io)` with fake streams; output that bypasses `io` is output no
test sees.

## Never call process.exit

Commands return `Promise<number>` — 0 clean, 1 findings, 2 rulecast itself failed — and `cli.ts`
assigns it to `process.exitCode`. Library code throws or returns a result.

`process.exit` ends the process before pending work settles: the session store's append, the lock
release in `core/session/lock.ts`, a detector's cache write. It also makes the function untestable,
because the test runner is the process it exits.

## Read env and cwd from what you were handed

Never `process.env` or `process.cwd()` outside `src/cli.ts`. Commands use `io.env` and `io.cwd`, the
core uses `project.root`, detectors use `input.cwd`, checks use `DetectorCheck.env`.

The hook rewrites the working directory to the project root (`commands/hook.ts`), so
`process.cwd()` in a hook is wherever the agent happened to be — often a subdirectory. Tests pass
their own env; code that reads the global one tests the machine instead. Building a child's
environment (`core/git.ts`, which then scrubs it) is the one reason to start from `process.env`.

**Backlog:** `detectors/llm/detector.ts` reads `process.env` because `DetectorRun` carries no `env`.

## Hooks fail open

Every path out of `hookCommand` returns 0, and everything in it that can throw is inside its `try`.
Problems go to `io.stderr` and the debug log. An adapter's `format` exits 0 and expresses blocking in
its JSON (`decision`, `permissionDecision`). A committed hook command must work in a fresh clone,
before `pnpm install`.

A hook that exits non-zero breaks the agent's turn over a problem the developer did not cause and
cannot see (spec §14). It went wrong five ways: a corrupt store crashed the hook (`5a63120`), a bare
`node_modules/.bin/rulecast` exited 127 on every event (`21e56db`), `install` rewrote the guarded
command back to the bare one (`8686ce2`), `doctor` said "ok" for hooks that could not run
(`84754b1`), and an oversized proposal blocked the agent (`8578864`).

**Backlog:** in `commands/hook.ts`, `adapter.parse`, `findRoot`, `ensureProjectState` and
`debugLogger` run before the `try`. An unwritable cache directory makes the hook exit 2.

## Prefix stderr with the tool name

A line written to `io.stderr` starts with `rulecast: ` and ends with a newline.

Hook stderr is interleaved with the agent's own output and with every other hook's. Unprefixed, a
line cannot be traced to rulecast; unterminated, it runs into the next tool's line.

## The core imports nothing from outside it

Nothing under `src/core/` imports from `adapters/`, `commands/`, `detectors/`, `init/` or `testing/`.
Detectors arrive through the `DetectorRegistry`, adapters through the `Adapter` type.

The core is agent-neutral and detector-neutral by construction (spec §3, §7). One upward import makes
it a cycle, and the next agent to read the core learns that reaching sideways is how this codebase
works.

## Adapters see only types and the renderer

An adapter imports `core/types` and `core/delivery/render-agent`, and never another adapter.

`src/index.ts` hands a third-party adapter exactly that surface. A built-in adapter that needs more
is proof the surface is too small, and the fix goes there, not in a private import.

## Detectors use only the plugin surface

A detector imports from `core/types`, `core/errors`, `core/which`, `core/template` and
`core/detection/{per-rule,tool,paths,positions,registry}`, and from nowhere else in `src/` — never
the pipeline, session, baseline, delivery, compile, config, home or git modules, and never another
detector.

The plugin API in `src/index.ts` is "what a third-party detector needs, and nothing else". A
built-in detector that imports past it can do things no plugin can, and its contract tests stop
proving the API is sufficient.

## The core names no detector kind

Code outside `src/detectors/` asks the registry for a declaration — `guards`, `metered`, `wholeFile`,
`takesContent`, `fileBudget`, `timeoutHint` — and never compares a kind string such as
`kind === "llm"`. The user-facing `--no-llm` flag is the one place a kind is named.

Spec §6, Declarations: a second metered detector should need no edit to the core. Plan 9 Task 7
removed nine such literals; each was a place a new detector would have been silently mishandled.

## The core names no agent

Facts about Claude Code — its 9,000 and 10,000 character limits, `restoredFiles`, its hook event and
tool names (`PreToolUse`, `Bash`, `Edit`) — live in `src/adapters/claude-code/`. The core sees
`Adapter` fields and the neutral events (`start`, `shell-before`, `shell-after`), and the
working-tree comparison stays in `core/session/tree.ts`.

Codex, Cursor and OpenCode are next (spec §7, plan 11 Decision 7). A Claude Code constant in the core
is a bug for each of them, found only when they ship.

## Heavy dependencies load lazily, by literal import

`@ast-grep/napi`, the `@ast-grep/lang-*` packages and `@clack/prompts` are imported statically only
as `import type`. Their values come from `await import("…")` with a literal specifier, in
`detectors/ast-grep/load.ts`, `detectors/ast-grep/languages.ts` and the dynamic import of
`init/clack.ts` in `src/cli.ts`. Never `createRequire`, `require(` or a computed specifier.

Every hook is a fresh process with a p95 budget of 500 ms (spec §13); a native module loaded at the
top of the graph is paid on every event that never parses anything. `bun --compile` bundles only
literal dynamic imports (spec §16, plan 5a Decisions 1 and 3), so a computed one works under node and
fails in the standalone binary.

---

## Guarding detectors read only through read

A detector that declares `guards: true` — `regex`, `path`, `ast-grep` — gets file contents only
through `read` on its `DetectorRun`. Never `readFile`, `readFileSync`, `readSourceFile`,
`sourceReader`, `createReadStream`, or anything else that opens the path. The guard itself
(`core/guard.ts`) measures and judges the proposal, never `stat` of the path.

Before a write, the content that matters is the one the agent *proposed*, which is not on disk and
never will be if the write is refused. A detector that reads the path judges the old file and lets
the write through. It is also what makes staged runs and `rulecast test` possible: both hand a
detector content no file holds. The old rule here missed `readSourceFile` and was blind on the two
files it was written for (`268407a`); the guard's size ceiling was measured on disk before
`8578864`.

`command`, `linter` and `llm` decline `guards` because they hand a path to another program, which
reads the file whatever this code does. For them reading the file is the honest form of the same
limitation. Resolving a path (`access`, `realpath`) is not reading it.

## Rethrow the clock before recording a rule error

A `catch` inside a detector's `run` that records `{ rule, message }` starts with
`if (pastDeadline(error, input)) throw error`. Checking `input.signal.aborted` is not enough.

A swallowed timeout becomes a rule error, and a rule error disables a working rule for the rest of
the session. ast-grep's native parse holds the event loop, so the abort timer never fires and
`signal.aborted` is still false when the deadline has long passed (`aced293`, after `5595f49`
introduced the `signal.aborted` form in three places). `pastDeadline` in `core/detection/per-rule.ts`
asks the wall clock as well.

## One bad rule is a rule error, not a run error

Reading, parsing and excerpting a file all happen inside the per-rule or per-tool `try` that records
`errors: [{ rule }]`, so the other rules keep their findings. `rule: null` — the whole run failed —
is for a run that cannot proceed at all; today only `llm` uses it, for an unavailable provider.
Findings are reported only for rule ids that were in the run, with exactly the declared captures as
strings and 1-based positions.

`testing/detector-contract.ts` checks each of these. Before `5595f49`, one unreadable file (`EACCES`,
`EISDIR`) took down every language in ast-grep and every tool in linter (spec §14).

## Detectors make no timers of their own

No `setTimeout`, `AbortSignal.timeout` or `new AbortController` in `src/detectors/`. Use
`input.signal` and `input.deadlineAt`; a synchronous loop calls `input.signal.throwIfAborted()` per
file and bounds itself by `deadlineAt`.

`core/detection/run.ts` owns the deadline and decides what a late detector means. A second clock
inside a detector disagrees with it, and a timer cannot fire while synchronous work holds the loop
(`core/types.ts`).

## Bound synchronous work by size, not by a timer

Work that holds the event loop needs a bound no timer has to enforce: regexes run inside the `vm`
timeout in `detectors/regex.ts`, native parsing sits behind `max_file_bytes`, and elapsed time is
read from the wall clock, not from which promise settled first.

`(a+)+$` never finished, and a 6.8 s run was recorded as clean (`ef8ae5f`). A 5.3 MB proposal blocked
the agent for 942 ms (`8578864`).

## Detectors never classify

A detector is never told about `scope`, never decides whether a finding is new or pre-existing, and
never filters by changed lines except as an input it was handed (`changes`). It reports everything it
sees.

Classification is the core's (spec §8, plan 8a Decision 6), and it is pinned by the goldens in
`test/goldens/classification/`. A detector that pre-filters makes the baseline lie: the finding that
was dropped is the one `container` scope needed to see.

---

## Spawn with an argument array, never a shell

Child processes are started with `execFile` or `spawn` and an argument array. Never `exec`,
`execSync`, or `shell: true`. Detectors spawn through `runTool` in `core/detection/tool.ts`.

A rule repo controls argv (`detect.command.run`), so a shell turns a rule into code execution with a
quoting bug (`core/which.ts`). `runTool` also owns the signal, stdin and output limits that each
hand-rolled spawn gets wrong once.

## Every git call goes through core/git.ts

Run git only through `git()` in `core/git.ts`, which strips the inherited `GIT_DIR`,
`GIT_WORK_TREE` and `GIT_INDEX_FILE` and treats a non-zero exit as a result. In tests, use `git()`
and `createRepo()` from `test/helpers/git.ts`, which also sets `core.hooksPath=/dev/null`.

Under a git hook those variables override `cwd`. Running the suite from pre-push once committed
fixtures to the branch being pushed and tagged this repository `v1.0.0` (`b98d0c2`, `d7a1256`). The
list of variables was then copied in two places, and removing one entry left the suite green
(`fd498c7`).

**Backlog:** `commands/init.ts` calls `execFileSync("git", ["rev-parse", "--show-toplevel"])`.

## List git paths NUL-separated

Every `git diff --name-only`, `ls-files` or `status` that lists paths passes `-z` and splits with
`nulSeparated`.

Without `-z` git quotes and escapes any path with a non-ASCII or special character
(`"caf\303\251.ts"`). No rule's `files` regex matches the quoted form, so the file is silently never
checked.

**Backlog:** `changedFilesSince` in `core/git.ts` lists both its diff and its untracked files without
`-z`.

## Pass file arguments after a double dash

When a program accepts paths, put them after `--`: `detectors/linter/tools.ts` and
`core/session/tree.ts` do.

A file named `-x.py` is otherwise read as a flag. File names come from the repository, which is
anyone's.

## Close a child's stdin and ignore EPIPE on it

Every child with piped stdin gets `child.stdin.on("error", () => {})` before `stdin.end(…)`, and
stdin is always ended. `runTool` in `core/detection/tool.ts` is the model.

A tool that exits without reading its stdin raises an unhandled `EPIPE` that kills the process; a
tool whose stdin is never ended waits forever. Both were found only on Linux (`c5d1cb6`).

## Pass the signal to everything you await

A function that takes a `signal` hands it to every `execFile`, `spawn` and `fetch` it reaches,
including the helpers it calls (`onPath`, `describeTool`, `provider.available`).

`doctor`'s 30-second deadline could never fire: the signal was created and nothing read it, so a
`command -v` on a stalled PATH mount hung forever (`1f6e140`).

## Read an external program's answer from its source of truth

Unwrap an envelope before scanning it, ask a registry or an API instead of parsing log lines, and
check a GitHub action's inputs against its own `action.yml`.

JSON was scanned inside a CLI's `result.stdout`, where its quotes are escaped, so a correct answer
could never parse and became a rule error (`109ef0c`). Parsing changesets' "New tag:" line shipped a
release with no tag (`f720a13`); a renamed action input meant no release ran for fourteen pushes
(`336062b`).

---

## Repo-relative paths use forward slashes

A path a rule matches is repo-relative with `/` separators. Convert tool output with `repoRelative`
or `repoRelativeTo` (`core/detection/paths.ts`) and agent paths with `toProjectPath`. A
`path.relative` result is either converted with `.split(path.sep).join("/")` or used only to test
containment. When a second caller needs a conversion, import the helper instead of writing one.

Rules match forward slashes; a backslash path drops its findings on Windows without an error. The
command detector's own `repoRelative` lacked the symlink and percent-decoding handling the linter's
copy had, so findings vanished (`5595f49`); three more duplicate pairs went in `1f6e140` and
`fd498c7`.

## File URIs go through fileURLToPath

Convert `file://` URIs with `fileURLToPath`, never `new URL(x).pathname`, and try both the root and
its realpath when matching a tool's path against the project.

SARIF URIs are percent-encoded, and checkers resolve symlinks — every macOS temp directory is one.
Both produced findings attributed to paths no rule selects (`5595f49`).

## Files the agent must read live under the project

Overflow files and `read`-mode references are written under `<root>/.rulecast/` and named to the
agent by their repo-relative path, never by a path under `~/.cache`.

Claude Code refuses reads under `~/.cache` by default, so the agent was pointed at files it could not
open (`1c64acc`).

## Path segments from a payload go through safeSegment

Every path segment derived from agent input — a session id, a repo name — passes through
`safeSegment` before it is joined into a path.

A session id of `.` or `..` escaped the sessions directory (`fdc1ca3`). The payload is written by
another program and is not ours to trust.

---

## Narrow every catch

A `catch` either narrows — `isNotFound(error)`, `instanceof SomeError`, `pastDeadline` — and rethrows
the rest, or is a probe that returns a fallback (`false`, `null`). An empty catch body carries a
comment saying why nothing can be done.

Hooks fail open, so a broad catch is a bug that never surfaces: the hook exits 0, the agent carries
on, and the rule that should have fired is quiet. `core/pipeline.ts` catches only
`CorruptStoreError` and `LockTimeoutError` for that reason.

## Use the helpers in core/errors.ts

"The file is gone" is `isNotFound(error)`, never an inline `code === "ENOENT"`. Error text is
`errorMessage(error)`, never `error instanceof Error ? error.message : String(error)`.

One definition each, which absent files and every user-facing message depend on. Inline copies drift:
the next one handles `ENOTDIR` and the others do not.

**Backlog:** `core/git.ts` compares `"ENOENT"` inline; `init/plan.ts` spells out `errorMessage` twice.

## Throw typed errors and match them with instanceof

A failure the caller must tell apart is its own class, `export class XError extends Error {}`, and is
recognised with `instanceof`. Never match on message text.

Messages are edited for readability; types are not. `DeadlineError` exists because a clock comparison
gave the wrong answer, and `pipeline.ts` dispatches on `CorruptStoreError` and `LockTimeoutError`.

## Error messages are lowercase fragments

An error message starts in lowercase and has no trailing period.

Messages are composed: `pipeline.ts` builds `${kind} detector failed for ${rules}: ${message}.` and
`main.ts` prints `rulecast: ${message}`. A capitalised, full-stopped message reads as two sentences
glued together.

---

## No module-level mutable state

Nothing in `src/` holds mutable state at module level: no top-level `let` or `var`, and no mutating a
module-level object. Anything a module needs is passed in.

Every hook is a fresh process (spec §3, §13: no daemon, no in-process caches), so a module-level
cache buys nothing and costs correctness: two rules in one run see each other's leftovers, and a
test's state leaks into the next. Caches worth having are persistent and content-addressed, behind
the `cache` a detector is handed.

**Two exceptions, both commented in place.** `detectors/ast-grep/load.ts` memoises the native
module's registration, which is process-global whether we like it or not (plan 5a Decision 2).
`detectors/regex.ts` reuses one `vm` context and its `SCOPE` object, because the context is the
expensive part and it is cleared in `finally` on every call.

## Stores are appended only through jsonl.ts

The session and baseline stores are written only by `appendRecords` in `core/jsonl.ts`, as one
`O_APPEND` write per event, and never hold file content. A touch's snapshots and fingerprints go in
the same append. The session lock is taken only in `commitSession` (`core/session/session.ts`);
detection, change sets and baseline appends stay lock-free.

Small appends do not interleave across concurrent hook processes; two writes can. A crash mid-append
corrupted every later read until `appendRecords` learned to drop a partial last line (`738109b`). A
fingerprint without its snapshot is worse than none (plan 9 Decision 7).

## Change detection compares content, not mtime

`treeState` and `treeChanges` in `core/session/tree.ts` decide "changed" by hash up to 1 MiB, and
fall back to mtime and size only above that.

`git stash && git stash pop` moves no HEAD and rewrites every dirty file. By mtime, the developer's
work was attributed to the agent (`99b00f9`).

## Cache keys include every input that chooses the answer

A persistent cache key — `callKey` in `detectors/llm/call.ts`, the detector cache — covers every
input that can change the answer: provider, `base_url`, model, content, change set, rule configs,
grounding.

Without `base_url` in the key, a local Ollama and a hosted gateway read each other's answers from a
cache that never expires (`109ef0c`). A stale cache hit looks exactly like a correct one.

## A missing baseline means new

No baseline means every finding is new. No fingerprint record means `instance` classification. An
empty record means the rule was measured and the file was clean. Never add a heuristic that leans the
other way.

Spec §8, plan 8a Decisions 2 and 5. Erring towards "pre-existing" lets an agent's violation through
without anyone seeing it; erring towards "new" costs one extra finding.

---

## The renderer prices its own output, a line at a time

The context budget in `core/session/decide.ts` spends what `renderAgentText` prints, and asks
`deliveryCost` and `measureRuleBlock` in `core/delivery/render-agent.ts` what each part costs. Never
put a size estimate in `decide.ts`, and never copy a string the renderer prints into it. A line added
to the renderer gets its price in `deliveryCost`, built from the same helper; a line whose final form
is unknown when the budget is spent is priced at its longest form.

Five hand-tuned constants did exactly that, and 5,708 of 24,000 random deliveries rendered over their
limit until plan 9 replaced them (`48e49ff`). Price bounded units — one line, one rule's block, one
section's frame — never a growing section from inside the loop that grows it: with no budget
(`json`, `sarif`) that is quadratic, and 20,000 backlog summaries took 14.8 seconds.
`test/core/session/decide-scale.test.ts` and `decide-fits.test.ts` guard both.

## Decisions read what was found, not what fitted

The stop gate, exit codes and the overflow file read the classified findings, never
`delivery.findings` after `trim`. Blocking blocks are placed before swept ones.

The gate once asked the trimmed list, so an error the budget's floor dropped let the agent stop
(`fd498c7`); swept blocks took floor room the blocking ones needed (`cfa4996`). What fits in the
agent's context and what is true are different questions.

## Finding text goes through renderTemplate

A finding's message is built only by `renderTemplate` (`core/template.ts`), which collapses
whitespace to one line. Never concatenate raw match text, `{{text}}` or a model's reason into output.

131 of 168 findings carried newlines from multi-line ast-grep matches, and every renderer assumes one
finding per line (`905d935`).

## Count the unit you print

A number shown to a person counts exactly what its noun says — rules, not blocks; enabled rules, not
all — and every summary mode carries the same skipped and checked lines.

The title counted blocks as rules (`cfa4996`); disabled rules were reported as "skipped", and
`--summary` dropped the skipped and checked lines (`8686ce2`, `9e02d77`). A wrong count in a summary
is how a developer stops trusting the summary.

## Output depends on neither clock nor locale

What is rendered for the agent or the developer contains no wall-clock time, and its order never
depends on the machine's locale. `Date.now()` is for deadlines and lock staleness; a time-stamped
file takes an injected `now`. Sort ties break by code unit (`a < b ? -1 : …`), never
`localeCompare` or `Intl`.

`testing/adapter-contract.ts` requires `format` to be deterministic, the goldens pin the rendered
text, and the llm cache key depends on the order of its parts.

## Notices go to the developer, not the model

`Delivery.notices`, compile warnings and detector warnings are shown to the developer (`systemMessage`
in Claude Code), and the agent's text is rendered with `notices: false, warnings: false`.

Spec §9, Oversight; plan 10 Decision 10. An agent that silences a finding must not be the only one
who knows, and rule problems are the developer's to fix — an agent told its rule is broken "fixes"
the rule.

---

## Validate external input with safeParse

External input is validated with `safeParse` or `safeParseAsync`, never `.parse`. Schemas for what
people write — the config, a rule, each `detect.*` — are `.strict()`. Schemas for agent payloads and
model responses are not, so a new upstream field is tolerated.

Strict mode is what turns a typo into "unknown key … (did you mean …)" (`core/errors.ts`).
`.parse` throws, and a throw in a hook is a fail-open that hides the reason. A payload the adapter
does not handle must give `null`, never a throw.

## Narrow untrusted JSON, never cast it

`JSON.parse` of another program's output is `unknown`, narrowed with a type guard or a zod schema,
never `as Shape`.

A misconfigured checker must produce a rule error naming it (`detectors/command/results.ts`,
`linter/tools.ts`), not a crash three functions later. rulecast's own stores (`core/jsonl.ts`, the
detector cache) are the exception: we wrote them.

## Omit optional fields, never set them to undefined

Write `...(x === undefined ? {} : { x })`, never `{ x: undefined }`.

The adapter contract compares with `node:assert/strict`, which tells `{ a: undefined }` from `{}`,
and records round-trip through JSONL, which drops the key. A field that is sometimes `undefined` and
sometimes absent fails the contract on one machine's payload and not another's.

## Switch over internal unions without a default

A `switch` over a union rulecast defines has no `default` branch, so a new member fails the
type-check. `default` is for strings from outside: hook names, argv.

A `default` absorbs the next member silently. `adapters/claude-code/adapter.ts` has
`default: return NONE` over `EventKind`, which is exactly where a new event kind would vanish.

## Module style

- Relative imports have no `.js` suffix (`moduleResolution: Bundler`, built with tsup).
- Built-ins use the `node:` prefix; `import path from "node:path"`.
- No default exports, no `enum`, no classes except `Error` subclasses.
- No `any`, no `@ts-ignore`; a `biome-ignore` carries its reason.

Each is how all of `src/` is written today. Biome checks some of them; the rest are what the next
file will copy.

## Name the config files by constant

Code that builds a path to `.rulecast-config.yaml` or `.rulecast-rules.yaml`, or compares a name with
one, uses `CONFIG_FILE` and `MANIFEST_FILE` from `core/config/load.ts`. A message that names the file
for a person may spell it out.

A second literal in a `path.join` is a second place to forget when either name changes, and a grep
for the constant stops finding every reader.

## Group by appending in place

Group into a map with `get` and `push`. Never `map.set(k, [...(map.get(k) ?? []), x])`.

The spread copies the whole group on every item. Grouping findings that way was quadratic: 62,000
matches took 5.9 s, and an 8 MB file never finished (`71f2f69`). Six places still group *rules* that
way, which are few; the next copy will group matches.

---

## A rule key is four changes, not one

Adding or changing a key in the rule format touches, together:

1. `src/core/config/schema.ts` — the schema, in snake_case.
2. `src/core/compile/rule.ts` — the compiled shape, the default, and any diagnostic.
3. `docs/specs/2026-09-15-rulecast-design.md` §4 — the key, and §8, §11 or §12 if it changes
   behaviour.
4. `agents/reference/rule-format.md` — what an agent reading the reference will see.

A key that exists in the schema and nowhere else is a key nobody will ever use. If it ships in the
catalog, `packages/rulecast/scripts/manifest.ts` carries it through and `.rulecast-rules.yaml` is
regenerated with `pnpm manifest`.

## Never run a metered detector as a side effect

Any new code path that runs detection checks the detector's `metered` declaration: no `init`
preselection, no fingerprints at `touch`, no `doctor` dry run, no bare `rulecast test`, and no staged
`rulecast run` without `--llm`.

A metered detector sends the developer's code to a provider and costs money for every file (spec §6,
Consent). Each command that runs detection was once one line away from doing it unasked (plans 6c,
7a, 8a, 8c, 10). `test/core/detection/metered.test.ts` pins the paths that exist; a new one is
pinned by nobody.

## Hooks never fetch

`hook` and `warm` compile with `cachedRepos`. Only interactive commands use `fetchingRepos`.

A hook has 350 ms and no network promise (spec §4, plan 3a Decision 6). A pinned repo missing from
the cache disables its rules with a warning; the CLI is what fetches it.

---

## Adapter parse returns null, never throws

`Adapter.parse` is pure and returns `null` for any input it does not handle: junk, an unknown event,
a field of the wrong type.

The adapter contract feeds it `null`, `""`, `[]` and `{}`. A throw from `parse` reaches the hook,
which must exit 0 regardless — see [Hooks fail open](#hooks-fail-open).

## Map every variant of an agent event explicitly

`parse.ts` handles each `source` and prompt kind by name, and each new branch adds a recorded payload
under `test/payloads/`. An unhandled variant is never left to fall through to `null`, and nothing the
agent generates is read as the user.

`clear` and `fork` fell through, so their sessions had no start snapshot (`cfa4996`). Background
`<task-notification>` prompts were read as the user and reset the stop gate (`b2fbc3d`).

## Upgrade installed hooks in place

A new event source gets its own group in `hookGroups`. Merging is idempotent; an upgrade rewrites
each existing entry in place and never adds a second. Never widen an existing matcher, and never
rewrite the guarded local command.

Widening `startup|resume|compact` would have stopped matching older installs, and two hooks would
fire per event (`cfa4996`). Re-running `install` swapped the guarded command for one that exits 127
(`8686ce2`). `testing/adapter-contract.ts` pins the round trip.

---

## Tests never reach the network

No test in `pnpm test` may call a model or open a socket to one (spec §15). The helpers own the
exceptions: `test/helpers/llm-server.ts` runs a local `node:http` server (`fakeApi`) for the
`anthropic` and `openai-compatible` providers, and `test/helpers/llm.ts` puts a stub agent CLI
(`stubAgentCli`) in a fixture's `node_modules/.bin`. `RULECAST_LLM=1` and `RULECAST_LINTERS=1` opt
into the real thing, outside `pnpm test`.

A suite whose result depends on a network, a machine's credentials, or what happens to be installed
is a suite nobody trusts when it goes red. A real model call also costs money on every push.

## Every test gets its own cache home

A test passes `testEnv` (or `TEST_HOME`) from `test/helpers/home.ts`, or its own `mkdtemp` home, as
`RULECAST_HOME`, and so does every child process that may run rulecast. Never `homedir()` in a test,
and never a path under `~/.cache/rulecast`. In `src/`, only `core/home.ts` calls `homedir()`.

A test that writes the developer's real cache corrupts their sessions and passes or fails on what
earlier runs left there (plan 3a Decision 5).

**Backlog:** `test/integrations/pre-commit.test.ts` runs rulecast through real git hooks with
`process.env` and no `RULECAST_HOME`.

## Tests never chdir and never write inside the repository

Pass `cwd` explicitly — `captureIo(cwd)`, `event.cwd`, a detector's root. Never `process.chdir`. A
test's files go in a fresh temporary directory, normally from `createProject()` or `createRepo()`,
never under the repository, `__dirname` or `import.meta.url`.

Vitest shares a worker across a file's tests and runs files in parallel, so a `chdir` moves every
other test. A write inside the repository dirties the tree lefthook and rulecast judge, and leaves
debris a later run reads.

## Stub env vars and restore what you assign

Change an environment variable with `vi.stubEnv` and undo it with `vi.unstubAllEnvs()` in
`afterEach`. A test that must assign `process.env` itself — because it tests the real inheritance —
snapshots and restores it in `finally`.

`vitest.config.ts` does not set `unstubEnvs`, so a missing unstub leaks into every later test in the
file. `b98d0c2` and `d7a1256` depend on the restore.

## Keep PATH stubbed where a tool could run

A test that can reach the `llm` or `linter` detector, or a command that looks tools up (`doctor`,
`init`), stubs `PATH` to `/usr/bin:/bin` and puts the stub it means in the fixture's
`node_modules/.bin`.

A developer with `claude` or `ruff` installed must not turn a red test green (plan 7a). The linter
contract once passed only because ruff happened to be absent (`5595f49`).

## No skipped tests

No `test.skip`, `describe.skip`, `test.todo`, `xit` or `xdescribe`. A test that needs an optional
tool or a live call is gated on a named condition with `describe.runIf` or `describe.skipIf`, and
says why when it skips.

Biome catches `.only`; nothing catches `.skip`. A skipped test is the cheapest way to make a red
suite green, and it stays skipped. The four existing gates (`binary.test.ts`,
`integrations/pre-commit.test.ts`, the two `live.test.ts`) each name their condition.

## No mocks

No `vi.mock`, `vi.doMock`, `vi.spyOn` or fake timers. Use temporary projects, the stub agent CLI, the
local `fakeApi` server, and `captureIo` injection.

The suite is integration-style throughout, and `CliIo` is the seam built for it. A mock tests the
mock: `fakeBin(uv)` was installed and never consulted, and the test passed (`1f6e140`).

## Never raise a timeout to make a test pass

The 20-second test and 30-second hook timeouts in `vitest.config.ts` already leave an order of
magnitude of headroom. A per-test timeout is for build, binary, stress and live work only.

A higher timeout turns a hang into a slow pass. `/proc/nonexistent` hung vitest on Linux, and with it
CI and the release (`f0c6d85`).

## Write test, not it

Tests use `test` and `describe` from `vitest`, named as a sentence stating the behaviour: "a fixture
does not run the repository's hooks". No `it`, no "should".

It is how all 166 test files read. A name that states the behaviour is the first thing a failure
prints.

## Goldens are written by hand

Expected values in `test/goldens/` are written by hand or copied from a run someone read. Never write
a script, snapshot or `--update` path that records them from `renderAgentText` or `classify`. When a
golden fails, decide which side is wrong before touching either; a golden that changes in a
behaviour-preserving commit is a bug.

An expectation generated from the implementation proves nothing (`test/goldens/README.md`). The
container-boundary goldens caught an off-by-one 74 other tests missed — never delete them. The site's
landing page renders `goldens/delivery/shell-edit`, so a golden change is also a site change.

## A changed test is a finding

When a refactor fails a test, or a planned test fails, find the cause before editing the test. A
test is changed only in the task that means to change its behaviour.

Plan 9 Task 3: one deleted test was what showed a "refactor" removed behaviour. Editing the
assertion until it passes is the shortcut every red test offers.

## Every assertion must be able to fail

Assert the exact line or value, not a substring that also appears elsewhere. Never assert on a
collection nothing writes to. Fake the tool the code actually consults. Each `--check` gate has a
test of its failure path.

`toContain("1 warning")` was already satisfied by "0 errors, 1 warning" (`1f6e140`). Two assertions
could never fail, and no `--check` gate's failure path was tested (`ebaa233`). A test pinned the
wrong `/v1/v1` URL (`4a6a754`).

## Recorded payloads are recordings

Files under `test/payloads/` are real recordings, with only the rewrites their README documents
(`/project`, `__ROOT__`). Never edit one to make a parser test pass: record a new one and add its row
to the README table.

An edited recording tests the parser against what the author believed the agent sends.
`test/adapters/claude-code/parse.test.ts` is the hand-written authority; the payloads are the
evidence.

## Tests are platform-neutral

Never touch real system paths (`/proc`, `/sys`, `/private`, `/etc`); make an unwritable path a path
under a regular file. Build symlinks with `test/helpers/symlink.ts`. Install the fake tool a test
needs rather than relying on one being absent. Run `pnpm test:linux` before pushing a change to
filesystem, git, subprocess or scratch-directory code.

`/proc/nonexistent` hung vitest on Linux (`f0c6d85`); tests assumed macOS's `/tmp` is a symlink
(`2524121`).

## Tests derive the version

A test that needs rulecast's version imports `VERSION`. Never a literal.

A hard-coded "running 0.0.0" broke the 0.1.0 bump inside the release job (`b4e4335`).

## The contract suites import no test framework

`src/testing/` asserts with `node:assert/strict` and takes `test` as an argument. It never imports
`vitest`, `node:test` or `@jest/globals`, and nothing else in `src/` does either.

The suites ship in the package for plugin authors, who use whatever runner they like
(`test/build.test.ts`: "imports no test framework").

---

## Catalog rule ids carry no package prefix

In `packages/rules-*/rules.yaml`, write `id: thin-routes`, not `python/thin-routes`; the manifest adds
the prefix. `@` context paths are relative to the package — `@errors.md#swallowed-exceptions`, never
`@packages/…` or `@docs/…`.

`scripts/manifest.ts` (`idPrefix`, `rewritePath`) adds both. A prefixed id publishes as
`python/python/…`, and a package-rooted path resolves to nothing.

## A new catalog rule is registered and tested

A new or renamed catalog rule updates `CATALOG` in `test/catalog.test.ts` (in manifest order), adds a
firing and a quiet `cases` entry, carries good and bad `examples` (unless it is `llm` or a touch
rule), and is followed by `pnpm manifest`.

`catalog.test.ts` enforces each of these. The shortcut is to shrink `CATALOG` or delete the case
instead.

## Pin rulecast URLs to a tag

URLs to `syv-ai/rulecast` in the root `README.md`, `agents/` and `src/` use a tag (`vX.Y.Z`) or a
placeholder (`<tag>`, `${tag}`), never `main`.

A tag resolves to the same file forever; `main` changes under every user who already has the link
(spec §12). `test/agents-docs.test.ts` checks both the pin and that the path exists.

## Agent docs link relatively and stay put

Links between docs in `agents/` are relative (`../reference/detectors.md#regex`), and both the file
and the anchor exist. `agents/SETUP.md`, `DRAFT-RULES.md`, `reference/rule-format.md` and
`reference/detectors.md` are never renamed or moved.

`agents-docs.test.ts` resolves every link. The site rewrites relative links to its own pages, and
users hold tag-pinned URLs to each of the four files.

## Generated files are regenerated, never hand-edited

`.rulecast-rules.yaml`, `packages/rulecast/README.md`, `packages/rulecast/LICENSE` and
`packages/rulecast/src/core/version.ts` are written by `pnpm manifest`, `pnpm readme` and
`pnpm sync-version`. Edit the source — `packages/rules-*/rules.yaml`, the root `README.md` and
`LICENSE`, `package.json` through changesets — and run the script.

CI runs each script with `--check`. A hand edit passes locally and is overwritten by the next
regeneration, or fails CI on a diff nobody can explain.

## Release through a changeset

Never edit `version` in `packages/rulecast/package.json`, edit `CHANGELOG.md`, or create a tag. Add a
changeset (`pnpm changeset`, pick `@syv-ai/rulecast`; never the site, which `.changeset/config.json`
ignores). Tags are bare `vX.Y.Z`, made by `release.yml`.

`latestTag` in `core/repos/tags.ts` accepts only `vX.Y.Z`: changesets' own `@syv-ai/rulecast@0.1.0`
tag would have given every user zero catalog rules (`ebaa233`). `version-packages` also regenerates
the README mirror, without which the version PR turns main red (`447ebfb`).

## README sections are mapped by the site

Adding, renaming or removing a `##` heading in the root `README.md` updates `PAGES`, `FRAGMENTS` or
`DROPPED` in `packages/site/scripts/sources.ts`. The "A rule" section keeps its first yaml block,
whose `message` must produce a line of the lead's output; the "Agents" section keeps its `text`
prompt. The generated pages under `packages/site/src/content/docs/` (all but `index.mdx` and
`how-it-works.mdx`) are build output and are never edited.

`sources.ts` throws on an unplaced or missing section; the site build is the check, and it runs from
the latest release's README, so a break surfaces a release later.

## Workflows that follow a release are called

Anything that must run after `release.yml` is a `workflow_call` job that `release.yml` calls. Never
`on: release`, `create` or `workflow_run` for an event `GITHUB_TOKEN` raises. A workflow step longer
than one command is a script in the repository, and no step uses `continue-on-error`.

Events raised by `GITHUB_TOKEN` start no workflow, so v0.2.0 and v0.3.0 shipped with no binaries and
nothing went red (`df3dd44`). A script can be run locally; an inline step can only be debugged by
pushing (plan 7b). A fake green is worse than no signal.
