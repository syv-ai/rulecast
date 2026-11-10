# Commands

The commands most projects use are in the README's [Commands](../README.md#commands). `rulecast <command> --help` prints a command's flags.

## Advanced commands

Most projects never run these by hand.

| Command | Does |
|---|---|
| `rulecast baseline` | Record today's findings, so full-repo runs fail only on new ones ([A committed baseline](advanced.md#a-committed-baseline)) |
| `rulecast replay claude-code` | What your rules would have told the agent in its recent sessions, from their transcripts |
| `rulecast autoupdate` | Move pinned rule repos to their latest tag |
| `rulecast try-repo` | Run a rule repo against your project without configuring it |
| `rulecast clean` | Delete the cache |
| `rulecast warm` | Build detector caches ahead of time (no built-in detector needs it yet) |
| `rulecast hook <adapter>` | Answer an agent hook on stdin (the agent runs this, not you) |

## Exit codes

`rulecast run`, `rulecast try-repo` and `rulecast fix` (after its fixes) exit with:

| Code | Meaning |
|---|---|
| `0` | Every rule ran; no new error-severity findings (warnings and pre-existing findings allowed) |
| `1` | Every rule ran; at least one new error-severity finding |
| `2` | rulecast could not run: usage, a config file that does not load, git, or an internal error |
| `3` | Incomplete: a rule failed to compile, a rule repo could not be fetched, a detector failed or timed out. Findings that were produced are still reported. Wins over 1 |

- On `2` nothing is printed to stdout. `try-repo` also exits `2` when the repo it tries can't be fetched.
- `rulecast test` exits `1` when an example fails; `rulecast baseline` exits `3` when a rule could not run. Other commands use `2` for the problems they find.
- `--format json` and `--format sarif` are a stable contract, with an id per finding that survives code moving around: see [`agents/reference/output.md`](../agents/reference/output.md).
