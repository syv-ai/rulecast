# rulecast output contract

What a script, a CI job or an agent loop can rely on from `rulecast run` and `rulecast try-repo`: the exit code, the JSON document and the SARIF log. Also the JSON of [`rulecast stats`](#rulecast-stats). The terminal and `agent` formats are for people and agents to read, and can change in any release.

Relative links in this file resolve against this file's own URL.

```sh
rulecast run --from-ref origin/main --format json    # or --all-files, --files F..., staged by default
rulecast run --from-ref origin/main --format sarif   # for GitHub code scanning
```

## Exit codes

| Code | Meaning | stdout |
|---|---|---|
| `0` | Every rule ran, and no new finding has severity `error`. Warnings and pre-existing findings are allowed. | the report |
| `1` | Every rule ran, and at least one new finding has severity `error`. | the report |
| `2` | rulecast could not run: a usage error, a config file that does not load (YAML, schema, `minimum_rulecast_version`), git, or an internal error. | empty; the message is on stderr |
| `3` | Incomplete: a rule failed to compile, a rule repo could not be fetched, a detector failed or timed out. The findings of the rules that did run are still reported. | the report, with `complete: false` |

`3` wins over `1`: a `1` promises that every rule ran. A loop can stop on `0`, fix and retry on `1`, and needs a person on `2` or `3`.

These are not incomplete, because they are limits the project set rather than failures: a staged run skipping `llm` rules (listed in `skipped`), `llm` rules over `llm.max_files_per_verify` (a warning names the files), and a whole-project rule skipped in a staged run because its files differ from the working tree (a warning). Read `warnings` and `skipped` to see them.

Other commands keep their own codes: `validate` and `doctor` exit 2 on the problems they find, `test` 1 on a failed example.

## JSON

`--format json` prints one document:

```json
{
  "schemaVersion": 1,
  "complete": true,
  "findings": [
    {
      "id": "c065f4077622652f",
      "rule": "backend/no-httpexception",
      "severity": "error",
      "status": "new",
      "file": "app/services/users.py",
      "line": 3,
      "endLine": 3,
      "column": 5,
      "message": "app/services/users.py:3 raises HTTPException(500). Raise a domain exception.",
      "count": 1,
      "captures": { "args": "500" }
    }
  ],
  "preexisting": [
    {
      "id": "ca1e4d66dd8d38e3",
      "rule": "backend/no-httpexception",
      "severity": "error",
      "status": "preexisting",
      "file": "app/services/users.py",
      "line": 2,
      "endLine": 2,
      "column": 5,
      "message": "app/services/users.py:2 raises HTTPException(404). Raise a domain exception.",
      "count": 1,
      "captures": { "args": "404" }
    }
  ],
  "backlog": {
    "rules": [{ "rule": "backend/no-httpexception", "violations": 2, "files": 1 }],
    "files": [{ "file": "app/services/users.py", "violations": 2 }],
    "totalViolations": 2,
    "totalFiles": 1
  },
  "preexistingSummary": [{ "rule": "backend/no-httpexception", "file": "app/services/users.py", "count": 1 }],
  "references": [{ "ref": "conventions/backend.md#errors", "state": "full", "content": "## Errors\nServices raise domain exceptions." }],
  "touches": [],
  "warnings": [],
  "skipped": [],
  "checked": { "files": 1, "selection": "range" },
  "ignored": [],
  "notices": [],
  "stop": null
}
```

| Key | Meaning |
|---|---|
| `schemaVersion` | The version of this shape (below). |
| `complete` | `false` exactly when the exit code is 3. |
| `findings` | New findings: on lines the change touched. The exit code is decided by these. |
| `preexisting` | Findings that were already there before the change, in the same shape with `status: "preexisting"`. With `--all-files` or `--files` there is no baseline, so every finding is new. |
| `backlog` | Counts per rule and per file, new and pre-existing together. |
| `preexistingSummary` | Pre-existing findings counted per rule and file. |
| `references` | The doc sections the new findings' rules cite, with their text when it was read. |
| `warnings` | rulecast's own problems: a broken rule, a detector that failed, a timeout, an ignore without a reason. Not findings. |
| `skipped` | `llm` rules a staged run or `--no-llm` left out, when they matched a checked file. |
| `checked` | How many files were checked and how they were chosen: `staged`, `range`, `all`, `files` or `session`. |
| `ignored` | Findings a `rulecast-ignore` comment dropped: `id`, `rule`, `file`, `line`, `reason`. |
| `touches`, `notices`, `stop` | Agent-session fields; empty or `null` from the CLI. |

### A finding

| Field | Meaning |
|---|---|
| `id` | A stable id for the finding (below). 16 hex characters. |
| `rule` | The rule's id, or its alias when it has one. |
| `severity` | `error` or `warning`. |
| `status` | `new` or `preexisting`. |
| `file` | Relative to the project root (the directory holding `.rulecast-config.yaml`), with `/` separators. |
| `line`, `endLine`, `column` | 1-based. `endLine` is the last line of the match. |
| `message` | The rule's `message` with its template variables filled in. |
| `count` | How many matches this finding stands for. Findings of one rule in one file with the same rendered message are merged into one; that only happens when the message has no `{{line}}`. A merged finding shows its earliest match, and carries that match's id. |
| `captures` | The values the message template names, when it names any. |

### Finding ids

A loop needs to tell "the same finding as last run" from a new one, across runs, worktrees and pull requests. The id is a hash of:

- the rule id (the alias, when one is set),
- the file path,
- the matched text, with runs of whitespace collapsed to one space and the ends trimmed,
- the detector's captures, sorted by name (a tool rule's `ruleId` and `message`, a regex's named groups), except captures whose value changes from run to run: an `llm` rule's `reason`,
- the match's position among identical matches in the file (0 for the first, 1 for the second, …).

The line number is **not** part of it, so a finding keeps its id when lines are added or removed above it, and re-indenting the line or checking it out with CRLF line endings does not change it either. These do change it:

- Editing the offending text. That is a different violation.
- Adding an identical violation above it in the same file: the occurrence numbers of the ones below shift.
- Renaming the rule's alias, or moving the file.
- A tool message that contains a number that moves, such as a line count. The message is part of what the tool reports.

A `rulecast-ignore` comment does not renumber the other matches: ignored matches are counted when occurrences are numbered.

The id scheme has its own version: SARIF publishes it under `rulecastFindingId/v1`. If what the id hashes ever changes, that key changes with it, and `schemaVersion` is bumped.

### Version policy

`schemaVersion` is `1`. Adding a field leaves it at `1`, so read the fields you need and ignore the rest. Removing a field, renaming one, or changing what one means bumps it.

## SARIF

`--format sarif` prints a SARIF 2.1.0 log with one run.

| SARIF | From |
|---|---|
| `tool.driver` | `name: "rulecast"`, `version`, `informationUri` |
| `tool.driver.rules[]` | Each rule with a finding: `id`, `name` and `shortDescription` (the rule's `name`), `fullDescription` (its `description`), `defaultConfiguration.level` (its `severity`), `properties.context` (the refs it cites) and `properties.source` (`local` or the rule repo). `help` holds the text of the cited sections, each under its ref, as `text` and `markdown`; when none of them can be read it says `See <refs>`, and a rule that cites nothing has no `help`. |
| `results[]` | New findings with `baselineState: "new"`, then pre-existing ones with `baselineState: "unchanged"`, so code scanning does not read the backlog as fixed. |
| `results[].partialFingerprints` | `{ "rulecastFindingId/v1": <id> }`: the finding's id, so an upload matches the same finding across runs. |
| `results[].locations[].physicalLocation` | `artifactLocation.uri` is `file`; `region` has `startLine`, `startColumn` and `endLine`. |
| `results[].occurrenceCount` | `count`, when a finding stands for more than one match. |
| `results[].ruleIndex` | The rule's index in `tool.driver.rules`. |
| `invocations[0]` | `executionSuccessful` is `complete`; `toolExecutionNotifications` are the `warnings`. |

`artifactLocation.uri` is relative to the project root. For a project below the repository's top, code scanning needs paths relative to the repository; until rulecast writes them, run it from a project at the repository's top.

## rulecast stats

`rulecast stats --format json` says, per rule, what became of the findings agent hooks reported: whether the agent fixed them, kept being blocked on them, or silenced them. A loop that improves rules reads it to find rules that are noisy and rules that never fire.

```sh
rulecast stats --since 30d --format json    # 30d, 12h or a date; default: everything in the log
```

A date alone, such as `2026-09-01`, is midnight UTC. A date with a time needs its offset, as in `2026-09-01T10:00Z` or `2026-09-01T12:00+02:00`; without one it is refused, as is a date that does not exist.

```json
{
  "schemaVersion": 1,
  "window": {
    "since": "2026-09-16T12:00:00.000Z",
    "firstRecord": "2026-10-01T10:00:00.000Z",
    "lastRecord": "2026-10-05T09:01:00.000Z",
    "truncated": false
  },
  "sessions": 2,
  "rules": [
    {
      "rule": "backend/no-httpexception",
      "fired": 1,
      "blocked": 1,
      "refused": 0,
      "fixed": 1,
      "ignored": 0,
      "suppressed": 0,
      "prevented": 0,
      "open": 0,
      "repeated": 0,
      "medianTurnsToFix": 1,
      "repeatRate": 0,
      "suppressionRate": 0,
      "noisy": []
    }
  ],
  "neverFired": ["frontend/no-generated-edits"],
  "unknownRules": []
}
```

| Key | Meaning |
|---|---|
| `schemaVersion` | The version of this shape. It is versioned apart from `run`'s document, with the same policy: adding a field leaves it at `1`, and removing, renaming or changing the meaning of one bumps it. |
| `window.since` | The `--since` cut-off, or `null` for everything in the log. Only findings first reported at or after it are counted. |
| `window.firstRecord`, `window.lastRecord` | The oldest and newest record in the log, or `null` when it is empty. |
| `window.truncated` | The log has been rotated and does not reach back to `since`, so older findings may be missing. |
| `sessions` | Agent sessions with a record in the window. |
| `rules` | One entry per rule with a finding in the window, most fired first. |
| `neverFired` | Enabled detector rules in the current config with no finding in the window. Touch rules are left out, since they never report findings. Left out when anything in the config did not compile (see `notCompiled`). |
| `unknownRules` | Rules with findings in the window that are no longer in the config: removed, or renamed. Left out when anything in the config did not compile. |
| `notCompiled` | What in the config did not compile, such as a rule repo that has not been fetched (`rulecast install`) or a rule with an error. Present only when there is something. The rules it would have given are unknown, so `neverFired` and `unknownRules` would be wrong and are left out. The same lines go to stderr. |
| `skippedLines` | Lines of the log that could not be read, or that were not a whole record. Present only when there were any. |

Per rule, every count is of findings, and a finding is counted once per session however many times it was reported:

| Key | Meaning |
|---|---|
| `fired` | Findings first reported in the window. |
| `blocked` | Of those, findings that kept a stop from going through at least once. |
| `refused` | Findings a refused write rested on, or a shell write the agent was told to revert. |
| `fixed` | Gone at a later check that ran the rule on the file: an edit check or a stop. |
| `ignored` | Still there at a stop when the log ends: the agent was allowed to stop with it, after the stop gate's blocks ran out or because it is a warning. |
| `suppressed` | Dropped by a `rulecast-ignore` comment. That includes a comment on the finding's own line that changed its id, which happens when the match is the whole line, as with `llm` rules. |
| `prevented` | Only ever reported on refused writes, and the agent's next stop came without it: the agent gave up on the write, so the violation never reached the file. A refused finding that a later check of its file finds gone is `fixed` instead. |
| `open` | Still there, and no stop has seen it yet: the session is still going, or it ended without a stop. Never counted as ignored. |
| `repeated` | Still there at two or more stops, or refused twice or more: the agent kept hitting it instead of fixing it. |
| `medianTurnsToFix` | Over the fixed findings, how many of the agent's stops came between the first report and the fix. `0` is fixed in the same turn. `null` when none was fixed. |
| `repeatRate`, `suppressionRate` | `repeated / fired` and `suppressed / fired`, to two decimals. |
| `noisy` | `"repeats"` when a rule has fired at least 5 times and at least 30% of its findings repeated; `"suppressed"` when it has fired at least 5 times and at least 20% were suppressed. A noisy rule's message may not say how to fix it, or its pattern may be too broad. |

Things to know when reading the counts:

- A finding's identity is its [id](#finding-ids). Editing the offending text without fixing it changes the id, so it counts as one fixed finding and one new one.
- A finding the context budget kept out of a delivery still counts as reported.
- Only agent hooks write the log. `rulecast run`, git hooks and CI do not, and findings that were there before the session or are in files the user changed during it are not counted.

### The findings log

The counts come from `findings.jsonl` in the project's directory of the rulecast cache (`rulecast doctor` prints where). Agent hooks append one record per edit check, refused write and stop. A record holds finding ids, rule ids, file paths and line numbers, and never the message, the matched text or a capture, so no code is written to it. It never leaves the machine.

The file is rotated to `findings.1.jsonl` at 4 MiB, replacing the previous one, so the two together stay near 8 MiB. Hooks that reach the cap together rotate it once. A hook that crashes while writing can leave a partial line; the next record starts on a line of its own, and `stats` skips the partial one and counts it in `skippedLines`. Writing it is best effort: a hook never fails because the log could not be written. `rulecast clean` removes it with the rest of the cache.

Its format is internal and can change in any release. The `stats` JSON above is the contract.
