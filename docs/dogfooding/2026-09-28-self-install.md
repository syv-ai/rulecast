# rulecast on rulecast, 2026-09-28

pre-commit runs pre-commit on itself. rulecast did not, and grepping the specs and plans, nobody had
considered it. This is the record of installing it — plan `2026-09-28-rulecast-08d-self-install.md`.

It also road-tests `init` on a shape it had never seen: a pnpm workspace of four packages with no
application code, where the rule packages are data and the CLI is the product. The 2026-09-22 trial
was a FastAPI + React application.

**What this shows and does not.** The repository is clean on its own conventions — four rules, zero
violations — which was the expected result and is worth having. It says compliance here is free. It
says nothing at all about whether enforcement works, and this document must not be read as evidence
that it does. Measuring that needs the live harness, which is deferred.

## What `init` did

`pnpm build`, then the built CLI, not `npx @syv-ai/rulecast`: the point is to exercise the working
tree.

```
$ node packages/rulecast/dist/cli.js init --yes --agent claude-code

Detected
typescript · 42 other docs

Review
.rulecast-config.yaml  new, no rules yet
.claude/settings.json  +7 hooks (Claude Code)

Validate
rulecast validate: 0 rules valid
```

Run with `--yes --agent claude-code`, the path `agents/SETUP.md` tells an agent to take, rather than
interactively. **The interactive path is therefore still untested on a monorepo**, and someone should
run it by hand; a background session has no TTY and `init` correctly refuses without one.

Three things to say about that output:

- **`42 other docs`** is not actionable. `init` looks for `AGENTS.md` or `CLAUDE.md`, finds neither,
  and reports a count of everything else. The drafting prompt it prints then says "from the project's
  docs" without naming one, where normally it names the file. A repository whose documentation is a
  `docs/` tree gets a number instead of a suggestion.
- **Zero catalog rules is correct.** The catalog is Python, React and generated clients; none of it
  applies. But a config with an empty `rules: []` is a dead config, and the only thing pointing
  anywhere is the drafting prompt. `init` could say "nothing in the catalog matches this project" in
  those words.
- **`.claude/settings.json` was written without asking**, which is documented behaviour for
  `--yes --agent`. Worth knowing that `--yes` means it.

## The defect that mattered

The hooks `init` installed ran `rulecast hook claude-code` — the bare command, because rulecast was
not in this repository's `node_modules/.bin`. It is not on the PATH either. So the settings said the
hooks were installed, and every event did nothing.

`rulecast doctor` — the command whose entire job is to say why your rules are quiet — reported:

```
hooks
  ok       Claude Code — .claude/settings.json
```

It checked that the hooks were in the settings file and never that the command they run could be
found. Fixed: `doctor` now resolves the hook command and warns when it cannot, naming the lever.
**This is not specific to this repository.** Any project that installs the hooks without depending on
rulecast has it, which includes anyone who ran `npx @syv-ai/rulecast init` and did not add the
package.

The second, smaller one: `rulecast test --against` printed an empty "worst files" block at zero
findings, and its two closing notes — one about a rule that fires too much, one about a rule that
fires too little — read as a verdict there. All three of this repository's pattern rules measure
zero, and not one of them is a rule nobody would break. At zero the output now says what the zero
does not mean: it counts the stock, not how often an edit would break the rule.

## The conventions, and the ones that were dropped

Kept, in `.rulecast-config.yaml`, each pointing at `docs/conventions.md`:

| rule | shape | `--against packages/rulecast` |
|---|---|---|
| `detectors/no-direct-reads` | `regex` over `src/detectors/` | 0 violations in 0 of 29 matching files |
| `core/no-module-state` | `ast-grep` over `src/`, excluding the one documented exception | 0 of 108 |
| `tests/no-sockets` | `regex` over `test/`, excluding `test/helpers/` | 0 of 126 |
| `format/rule-keys` | `touch` on the schema and its compiler | — |

`docs/conventions.md` is new. The conventions were stated in the plans' "Conventions" lists, and a
plan is the record of one change: a rule's `context` should outlive it.

Dropped, and the reason is the more interesting half:

- **"Nothing in `src/` reaches for `process.env`."** True in spirit — spec §3 says anything a module
  needs is passed in — but `--against` found five sites, of which two are the composition root
  (`src/cli.ts`, which must), one is building a child process's environment, and one is a comment
  saying not to. A rule whose findings are four-fifths correct-by-design is the
  `react/no-inline-style` failure mode, and the volume check is what showed it.
- **"`src/` never imports from `test/`."** Zero violations, and no plausible way an agent breaks it.
  A rule that catches nothing costs an agent context for nothing.
- **"Tests never touch the real cache; use `test/helpers/home.ts`."** Real and load-bearing, and no
  pattern expresses it: the violation is *not* using a helper, and absence is what neither `regex`
  nor `ast-grep` can see. It stays in `docs/conventions.md` prose and could become a `touch` rule.

## A limitation of `--against`, found by using it

Every drafted rule measured zero. That is the "nobody breaks it" signal the volume check exists to
give — and here it is the wrong reading. The count is the repository's **stock**; what an author
wants to know is the **incidence**, how often an edit breaks the rule. Those are the same number
only in a codebase that has been diverging. In one that already complies they are unrelated, which is
exactly the situation this repository and every well-kept codebase is in.

So the check answers one of the two authoring-time questions well (is this true by definition?) and
the other badly (does anyone break this?). The output now says so at zero. Measuring incidence needs
edit history, which is the live harness's job.

## Cost, measured here

Ten runs each of the built CLI against `packages/rulecast/src/core/types.ts`, Apple M3 Pro, four
rules:

| hook | mean |
|---|---|
| `touch` (PostToolUse on Read) | 141 ms |
| `edit` (PostToolUse on Edit) | 106 ms |
| `guard` (PreToolUse) | 95 ms |

`touch` is the most expensive of the three, which is worth knowing now that it is also where
`container` fingerprints are measured (§8). It is not detection — there are no container rules here
— it is the snapshot write. `pnpm perf` on its own 30-rule fixture measured p50 216 ms, p95 254 ms
against the 500 ms budget on the same machine.

## How it is wired

- `@syv-ai/rulecast` is a root workspace `devDependency`, so `node_modules/.bin/rulecast` exists and
  the hooks run the local build rather than a bare command. **It points at `dist/`**, so a fresh
  clone needs `pnpm install && pnpm build` before the hooks do anything; until then they fail open
  and `doctor` now says why.
- `rulecast uninstall` then `rulecast install` reproduces `.claude/settings.json` byte for byte —
  the `AdapterInstall` round trip (§15), exercised here for the first time on a settings file that
  a person will also edit.

## Open

- The interactive `init` path on a monorepo, by hand, with a TTY.
- `init`'s "N other docs" line, and what it says when the catalog matches nothing.
- Renaming `docs/dogfooding/` to `docs/evidence/`. Agreed once, then deliberately reverted, so it is
  undone rather than rejected — it needs its own commit and the user's word.
