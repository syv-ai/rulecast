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
| `3` | Incomplete: a rule failed to compile, a rule repo could not be fetched, a detector failed or timed out. With `--session`, also a rule whose detector failed earlier in that session, which disabled it. The findings of the rules that did run are still reported. | the report, with `complete: false` |

`3` wins over `1`: a `1` promises that every rule ran. A loop can stop on `0`, fix and retry on `1`, and needs a person on `2` or `3`.

`rulecast run RULE_ID` is incomplete only over that rule: its own compile error, or a rule repo that failed and configures it. Another repo that could not be fetched is still a warning, but not a `3`.

`try-repo` fetches the repo it tries before anything runs, so a repo that cannot be fetched, or has no manifest, exits `2`.

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
| `fixable` | `true` when `rulecast fix` can apply this rule's fix; absent otherwise. Route these to `rulecast fix`, the rest to an agent. |

### `rulecast fix`

`rulecast fix [RULE_ID] (--files F... | --all-files | --from-ref A) [--dry-run] --format json` prints the same document, for a check of the files after the fixes were written, with these keys added:

| Key | Meaning |
|---|---|
| `dryRun` | Whether `--dry-run` was given. |
| `fixed` | `id`, `rule`, `file`, `line` of each finding a fix was applied to. The id is the one `run` reports on the files as they were, even for a finding fixed in a later pass after another rule's fix changed its line; the line is where it was when its fix was applied. |
| `changedFiles` | The files the fixes changed (or would change). |
| `unresolved` | Findings whose fix left the rule matching the text it wrote: the fix was undone. Same shape as `fixed`. |
| `diff` | With `--dry-run` only: a unified diff of every change. |

The exit codes are `run`'s, from that check: `0` when no new error finding is left, `1` when one is (a rule with no fix, an unresolved fix, a rule whose fix failed its own examples), `3` when a rule did not run, `2` when rulecast could not run. Under `--dry-run` nothing is written, so the check reads the files unfixed and leaves out the findings the fixes would remove: the code is an estimate, and a fix that would create or remove another tool's finding is not seen. A rule whose fix fails its examples is named in `warnings`.

### Finding ids

A loop needs to tell "the same finding as last run" from a new one, across runs, worktrees and pull requests. The id is a hash of:

- the rule id (the alias, when one is set),
- the file path,
- the source line or lines the match spans, with runs of whitespace collapsed to one space and the ends trimmed, and with a trailing `rulecast-ignore` comment left out, together with the punctuation that opens it in whatever syntax (`#`, `//`, `/*`, `/**`, `{/*`, `<!--`, `--`, `;`),
- the detector's captures, sorted by name (a tool rule's `ruleId` and `message`, a regex's named groups), except captures whose value changes from run to run: an `llm` rule's `reason`,
- the finding's position among findings of the same rule in the file whose lines and captures are identical (0 for the first, 1 for the second, …).

The line number is **not** part of it, so a finding keeps its id when lines are added or removed above it, including another violation of the same rule. Re-indenting the line, checking it out with CRLF line endings or adding a `rulecast-ignore` comment to it does not change it either. An id changes when the finding's line changes, which is also when rulecast counts the finding as new:

- Editing the line, even away from the matched text. The line is different, so it is a different finding.
- Adding a line identical to it above it in the same file: the occurrence numbers of the ones below shift.
- Renaming the rule's alias, or moving the file.
- A tool message that contains a number that moves, such as a line count. The message is part of what the tool reports.

Only an ignore that comment punctuation introduces is left out. One inside a string literal (`"rulecast-ignore: …"`) is part of the line, unless the string itself starts with comment punctuation (`"# rulecast-ignore: …"`). The punctuation run is taken whole, so write a space before the comment: in `f();// rulecast-ignore: …` the `);` goes with the `//`, and adding that comment changes the id.

A finding about a whole file hashes its text and captures instead of the file's lines, so an edit to the file keeps its id: a `path` rule's finding (its text is the path), and a hook's finding that covers the whole file (it would reformat the file, or failed without a location). Such a finding says it is about the whole file; one that merely spans every line of its file still hashes its lines. A secret a tool reports (gitleaks) hashes its redacted text and captures, never its line, so no part of the secret goes into the id; two secrets of one rule in one file are told apart by their order. If the file cannot be read, the matched text is hashed in place of its lines.

A `rulecast-ignore` comment does not renumber the other matches: ignored matches are counted when occurrences are numbered.

A merged finding (`count` above 1) carries its earliest match's id, so fixing that one match gives the merged finding a new id while the rest are still there. A loop that compares merged findings should compare `rule` and `file` as well as `id`.

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
