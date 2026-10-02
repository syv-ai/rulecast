# rulecast's own conventions

The conventions an agent working on this repository has to know, each with the reason. The
specification (`docs/specs/2026-09-15-rulecast-design.md`) is authoritative; this file exists so
rules have something stable to point at, because a plan records one change and a rule's reference
should outlive it.

## Detectors never read a file themselves

A detector that declares `guards: true` reads only through the `read` function on its `DetectorRun`
(spec §6, Contract). Never `readFile`, never `readFileSync`, never `readSourceFile`, never anything
else that opens the path.

The reason is the guard, and it is also the scope. Before a write, the content that matters is the
one the agent *proposed*, which is not on disk and never will be if the write is refused. A detector
that reads the path would judge the old file and let the write through. It is also what makes
`refuse_write` and `rulecast test` possible at all: both hand a detector content that no file holds.

`guards` is the promise to be able to do that, so it is exactly the set this binds. `regex`, `path`
and `ast-grep` declare it and read only through `read`. `command`, `linter` and `llm` do not declare
it, precisely because they hand a path to another program — ruff, eslint, a script, a model — which
would read the file on disk whatever this code did. For them, reading the file themselves is not a
violation but the honest form of the same limitation: `linter` and `llm` use `readSourceFile` to
serve `{{text}}` and to build a prompt, and `rulecast test`'s examples work because the example is
written to a real scratch file first.

`access`, `realpathSync` and the like are fine for anyone — resolving a path is not reading a file.
What a *guarding* detector must not do is get at the **contents** any way but `read`.

## No module-level mutable state

Nothing in `src/` holds mutable state at module level. Anything a module needs is passed in.

Every hook is a fresh process (spec §13: no daemon, no in-process caches), so a module-level cache
buys nothing and costs correctness: two rules in one run see each other's leftovers, and a test's
state leaks into the next. Caches that are worth having are persistent and content-addressed, behind
the `cache` a detector is handed.

**One exception, and it is in the code:** `src/detectors/ast-grep/load.ts` memoises the native
module's registration, which is process-global whether we like it or not (plan 5a, Decision 2).

## Tests never reach the network

No test in `pnpm test` may call a model or open a socket to one (spec §15). A suite whose result
depends on a network, a machine's credentials, or what happens to be installed is a suite nobody
trusts when it goes red.

The helpers own the exceptions: `test/helpers/llm-server.ts` runs a local `node:http` server for the
`anthropic` and `openai-compatible` providers, and `test/helpers/llm.ts` puts a stub agent CLI in a
fixture's `node_modules/.bin`. A test reaches for those, not for `node:http` itself.

`RULECAST_LLM=1` and `RULECAST_LINTERS=1` opt into the real thing, outside `pnpm test`.

## A rule key is four changes, not one

Adding or changing a key in the rule format touches, together:

1. `src/core/config/schema.ts` — the schema, in snake_case.
2. `src/core/compile/rule.ts` — the compiled shape, the default, and any diagnostic.
3. `docs/specs/2026-09-15-rulecast-design.md` §4 — the key, and §8/§11/§12 if it changes behaviour.
4. `agents/reference/rule-format.md` — what an agent reading the reference will see.

A key that exists in the schema and nowhere else is a key nobody will ever use. If it ships in the
catalog, `packages/rulecast/scripts/manifest.ts` carries it through and `.rulecast-rules.yaml` is
regenerated with `pnpm manifest`.
