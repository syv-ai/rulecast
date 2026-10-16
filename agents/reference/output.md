# rulecast output contract

What a script, a CI job or an agent loop can rely on from `rulecast run` and `rulecast try-repo`: the exit code, the JSON document and the SARIF log. The terminal and `agent` formats are for people and agents to read, and can change in any release.

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
  "stop": null,
  "baseline": null
}
```

| Key | Meaning |
|---|---|
| `schemaVersion` | The version of this shape (below). |
| `complete` | `false` exactly when the exit code is 3. |
| `findings` | New findings: on lines the change touched. The exit code is decided by these. |
| `preexisting` | Findings that were already there before the change, in the same shape with `status: "preexisting"`. With `--all-files` or `--files` the baseline is `.rulecast/baseline.json` when it exists (below), else there is none and every finding is new. |
| `backlog` | Counts per rule and per file, new and pre-existing together. |
| `preexistingSummary` | Pre-existing findings counted per rule and file. |
| `references` | The doc sections the new findings' rules cite, with their text when it was read. |
| `warnings` | rulecast's own problems: a broken rule, a detector that failed, a timeout, an ignore without a reason. Not findings. |
| `skipped` | `llm` rules a staged run or `--no-llm` left out, when they matched a checked file. |
| `checked` | How many files were checked and how they were chosen: `staged`, `range`, `all`, `files` or `session`. |
| `ignored` | Findings a `rulecast-ignore` comment dropped: `id`, `rule`, `file`, `line`, `reason`. |
| `touches`, `notices`, `stop` | Agent-session fields; empty or `null` from the CLI. |
| `baseline` | When the run classified against the committed baseline: `{ "file": ".rulecast/baseline.json", "entries": 412, "matched": 372, "stale": 40 }`. `entries` is how many ids the file lists, `matched` how many of this run's findings it made pre-existing, `stale` how many entries the run showed are gone (fixed, or the text changed). `null` when the run used no committed baseline. Never changes the exit code. |

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

### Committed baseline

`rulecast baseline` writes `.rulecast/baseline.json`, the ids of every finding there is today, to be committed. A run that has no baseline of its own (`--all-files`, `--files`, or a staged run before the first commit) treats a finding whose id is listed as pre-existing, and only the rest can fail it. A session, `--from-ref` or a staged run's `HEAD` always wins over the file, and agent hooks never read it.

Because it is keyed by id, the rules above apply: a finding whose text was edited, or whose file moved, is new. An entry the run no longer finds, in a file a rule that ran on it checked, is stale; `rulecast baseline --prune` drops stale entries and never adds any. An entry for a rule that did not run is neither matched nor stale. A file that is not JSON or not a baseline makes `run` exit 2. A file whose ids are from another id scheme is a warning, and every finding is new.

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
