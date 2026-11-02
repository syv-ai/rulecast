# Uncle Bob's quality-gate tools as rulecast rules, 2026-11-02

[ub-mode](https://github.com/unclebob/ub-mode) is a one-file agent skill: about 60 one-line principles,
paired with three deterministic tools from the same author. The principles live in a prompt, and the tools
run only when the agent remembers to run them. The question here was narrower: can the tools run as
rulecast `command` rules, so that their results reach the agent as findings at its stop, whether or not
it remembered?

- [crapper](https://github.com/unclebob/crapper): CRAP score per function, complexity × missing coverage.
- [mutator](https://github.com/unclebob/mutator): mutation testing. A surviving mutant is a change no test notices.
- [dryer](https://github.com/unclebob/dryer): structural duplication between functions.

Each supports Clojure, Java, Go, TypeScript, Rust and Python, writes EDN snapshots under `.metrics/`, and
signals through its exit code.

**Result: all three can run as `command` rules. mutator and dryer need no wrapper; crapper needs a small one,
because its output has no file or line.** In a replayed Claude Code session, an edit followed by a stop was
blocked with the surviving mutant as a finding. Each run took 0.5–3 s on small fixtures, so they belong at
the stop, not on every edit. A real test suite will be much slower: every mutant runs the tests.

**What this shows and does not.** It shows the wiring works on a small Python fixture and a small
TypeScript one. It does not show the cost on a real project, or how often the findings are worth an agent's
turn. Nothing was added to the catalog or to `agents/reference/tool-recipes.md`: tool-backed tells wait
until the lens review is applied.

## Setup

- The tools were cloned into separate directories and installed into their own venv, outside the repository.
- Fixtures: a Python package with one simple function and one complex, under-tested function, and pytest
  tests, including a weak test so one mutant survives. A small TypeScript package with vitest.
- Rules under `repo: local` in each fixture's `.rulecast-config.yaml`. Checked with `rulecast run --all-files`
  and with Claude Code hook payloads (an Edit, then a Stop) fed to `rulecast hook claude-code`.

## Per tool

| | Output rulecast reads | Limit to changed code | Time on the fixtures |
|---|---|---|---|
| mutator | stdout, one line per mutant (`SURVIVED  src/shop/pricing.py:28 >= -> >`), read with `lines` | `--changed`; later runs redo only survivors and changed functions | 0.9–1.2 s Python, 3.1 s TypeScript |
| crapper | none: its table and EDN have function names but no file or line | paths or `--changed`; coverage still runs the whole suite | 0.6 s Python, 1.3 s TypeScript |
| dryer | a block per pair, one `file:start-end` line per side, read with `lines` | none useful: one file only compares with itself | 0.3 s |

**mutator**, no wrapper:

```yaml
- id: quality/mutants-killed
  run: [mutator, --changed]
  scope: project
  output: { lines: { pattern: '^SURVIVED\s+(?<file>\S+?):(?<line>\d+) (?<message>.+)$' } }
  exit_codes: { error: [1, 2] }
  message: "{{file}}:{{line}}: mutant survived ({{message}}). No test fails when this changes; add a test that does."
```

The agent's stop was blocked with:
`error quality/mutants-killed  src/shop/pricing.py:28: mutant survived (>= -> >). No test fails when this changes; add a test that does.`

**crapper** needs a wrapper of about 40 lines. It calls crapper as a library, keeps the test run's output off
stdout, and prints rulecast JSON for each function over a threshold, at the function's line range. It
depends on crapper's internal functions, so an upstream change could break it. What the agent saw:
`src/shop/pricing.py:5: discount has CRAP 153.2 (complexity 15, coverage 15%). Add tests or split it.`

**dryer** works with a `lines` pattern and `scope: project`, at one finding per side of a pair. The partner
file and the score are lost; its `--edn` output would keep them, through a wrapper.

## What stands in the way

1. **Staged runs give wrong answers for tools that run the tests.** With no file flags, `rulecast run` checks
   staged content in a scratch copy under `.rulecast-staged-*`, which the tests never import. mutator then
   reported nothing, and crapper scored the function at 0% coverage. `scope: project` with the tool's own
   `--changed` avoids the copy. This applies to any `command` rule that runs a test suite, not only these.
2. **A function already over the CRAP threshold blocks any edit inside it.** There is no "before" result for
   a command rule, so the finding counts as new. A recipe would default crapper to `warning`.
3. **The tools share coverage files.** rulecast runs separate command rules at the same time, and both tools
   rewrite the same report under `target/coverage/<language>/`. It did not break in 8 runs, but a slow
   suite could. One wrapper that runs coverage once and then both tools would avoid it.
4. **They write into the project.** Both write `.metrics/` and `target/`. crapper pip-installs coverage and
   pytest into the project's interpreter when they are missing, and its first run downloads a parser.

## Where it leaves us

- mutator could be a recipe as it is: `--changed`, `scope: project`, at the stop. Of the three, it speaks
  most directly to loop safety: it catches a test that passes whatever the code does, which the
  assertion-counting rules do not.
- crapper would need the wrapper, or a JSON or SARIF output upstream. The data is already there internally.
- dryer is usable as is, if losing the partner location is acceptable.
- Thresholds such as CRAP < 10 are one author's defaults. Following plan 18, a threshold is a question for
  the conventions interview, not a catalog default.
- Item 1 is rulecast's own limit. `agents/reference/detectors.md` now says that a rule whose tool runs
  the tests needs `scope: project`.
