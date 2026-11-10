# Commands

The commands most projects use are in the README's [Commands](../README.md#commands). `rulecast <command> --help` prints a command's flags.

## Advanced commands

Most projects never run these by hand.

| Command | Does |
|---|---|
| `rulecast baseline` | Record today's findings, so full-repo runs fail only on new ones ([A committed baseline](adopting-rules.md#a-committed-baseline)) |
| `rulecast replay claude-code` | What your rules would have told the agent in its recent sessions, from their transcripts |
| `rulecast autoupdate` | Move pinned rule repos to their latest tag |
| `rulecast try-repo` | Run a rule repo against your project without configuring it |
| `rulecast clean` | Delete the cache |
| `rulecast warm` | Build detector caches ahead of time (no built-in detector needs it yet) |
| `rulecast hook <adapter>` | Answer an agent hook on stdin (the agent runs this, not you) |

## Exit codes

The exit codes, and the JSON and SARIF a script can rely on, are in the [output contract](../agents/reference/output.md#exit-codes).
