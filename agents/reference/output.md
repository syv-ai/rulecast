# rulecast output contract

What a script, a CI job or an agent loop can rely on from `rulecast run` and `rulecast try-repo`: the exit code, the JSON document and the SARIF log. [`rulecast test`](#rulecast-test) and [`rulecast stats`](#rulecast-stats) have their own documents. The terminal and `agent` formats are for people and agents to read, and can change in any release.

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

Other commands keep their own codes: `validate` and `doctor` exit 2 on the problems they find, `test` 1 on a failed example or a rule over `--max-rate` ([below](#rulecast-test)).

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
  "disabled": [],
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
| `warnings` | rulecast's own problems other than the rules in `disabled`: a timeout, an ignore without a reason, a file budget. Not findings. |
| `skipped` | `llm` rules a staged run or `--no-llm` left out, when they matched a checked file. |
| `disabled` | Rules that did not run, grouped by why: `[{ "reason": "…: not in the cache (run rulecast install)", "rules": ["python/no-bare-except"] }]`. A rule repo that could not be fetched, a detector whose tool is missing, a rule that failed to compile, and with `--session` a rule the session disabled that would have run here. Each rule is named once, here and not again in `warnings`. With `RULE_ID`, only what concerns that rule. Empty when every rule ran. When it is not empty, `complete` is `false` and the exit code is 3. |
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
| `fixable` | `true` when `rulecast fix` can apply this rule's fix; absent otherwise. Route these to `rulecast fix`, the rest to an agent. |

### `rulecast fix`

`rulecast fix [RULE_ID] (--files F... | --all-files | --from-ref A) [--dry-run] --format json` prints the same document, for a check of the files after the fixes were written, with these keys added:

| Key | Meaning |
|---|---|
| `dryRun` | Whether `--dry-run` was given. |
| `fixed` | `id`, `rule`, `file`, `line` of each finding a fix was applied to. The id and line are the finding's before the fix. |
| `changedFiles` | The files the fixes changed (or would change). |
| `unresolved` | Findings whose fix left the rule matching the text it wrote: the fix was undone. Same shape as `fixed`. |
| `diff` | With `--dry-run` only: a unified diff of every change. |

The exit codes are `run`'s, from that check: `0` when no new error finding is left, `1` when one is (a rule with no fix, an unresolved fix, a rule whose fix failed its own examples), `3` when a rule did not run, `2` when rulecast could not run. Under `--dry-run` nothing is written, so the check reads the files unfixed and leaves out the findings the fixes would remove: the code is an estimate, and a fix that would create or remove another tool's finding is not seen. A rule whose fix fails its examples is named in `warnings`.

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

A merged finding (`count` above 1) carries its earliest match's id, so fixing that one match gives the merged finding a new id while the rest are still there. A loop that compares merged findings should compare `rule` and `file` as well as `id`.

The id scheme has its own version: SARIF publishes it under `rulecastFindingId/v1`. If what the id hashes ever changes, that key changes with it, and `schemaVersion` is bumped.

### Committed baseline

`rulecast baseline` writes `.rulecast/baseline.json`, the ids of every finding there is today, to be committed. A run that has no baseline of its own (`--all-files`, `--files`, or a staged run before the first commit) treats a finding whose id is listed as pre-existing, and only the rest can fail it. A session, `--from-ref` or a staged run's `HEAD` always wins over the file, and agent hooks never read it.

Because it is keyed by id, the rules above apply: a finding whose text was edited, or whose file moved, is new. An entry is stale when:

- the run no longer finds it, in a file the rule ran on and checked;
- its file was deleted;
- its rule is gone from a config that compiled without errors (a rule missing because its repo could not be fetched or it failed to compile is not gone);
- its rule no longer matches the file, or no longer has the `verify` stage.

`rulecast baseline --prune` drops stale entries and never adds any. An entry for a rule that did not run (disabled, failed, or left out by `--no-llm`) is neither matched nor stale. `rulecast baseline` and `--force` give metered rules every file, past `llm.max_files_per_verify`; with `--no-llm` they name the rules left out, and `--force` keeps the old file's entries of every rule that did not run. A file that is not JSON or not a baseline makes `run` exit 2. A file whose ids are from another id scheme is a warning, and every finding is new.

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

## rulecast test

`rulecast test` runs each rule's examples ([rule-format.md](rule-format.md#examples)); with `--against` it fires each rule over real files instead. It is the gate for a rule an agent drafted: the examples pass, and the rule does not flag most of the files it matches.

```sh
rulecast test <rule-id> --format json
rulecast test <rule-id> --against . --max-rate 0.5 --format json
```

| Code | Meaning | stdout |
|---|---|---|
| `0` | Every rule compiled, every example that ran passed, and no rule is over `--max-rate`. | the report |
| `1` | An example failed, a rule is over `--max-rate`, or, without a rule id, a rule failed to compile. | the report; each compile diagnostic is on stderr |
| `2` | rulecast could not run: a usage error, no config or one that does not load, an unknown rule id, or a detector that failed under `--against`. | empty; the message is on stderr |

A detector that fails on an example is not a `2`: that example fails, with the detector's message as its `error`. Neither is a rule that failed to compile: it is in no entry of `rules`, since nothing tested it, and `passed` is `false`. `rulecast validate` says why. A named rule is tested alone, so another rule's compile error does not fail it; a named rule that did not compile is an unknown rule id.

`--format json` prints one document:

```json
{
  "schemaVersion": 1,
  "passed": false,
  "rules": [
    {
      "rule": "backend/no-print",
      "detector": "regex",
      "scope": "instance",
      "status": "failed",
      "examples": {
        "outcomes": [
          {
            "kind": "bad",
            "index": 0,
            "path": "backend/app/services/users.py",
            "passed": false,
            "expected": { "fires": true, "lines": [2, 4] },
            "findings": [
              { "line": 2, "endLine": 2, "column": 1, "text": "print(", "message": "backend/app/services/users.py:2 prints. Use the logger instead." }
            ],
            "failures": ["expected lines [2, 4], found [2]"]
          }
        ],
        "precision": { "correct": 1, "total": 1 },
        "recall": { "matched": 1, "total": 1 }
      },
      "against": null
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `schemaVersion` | The version of this document. It is versioned on its own, apart from `run`'s, under the same [policy](#version-policy). |
| `passed` | `true` exactly when the exit code is 0. |
| `rules` | One entry per rule tested: every detector rule, or the one named. |
| `rules[].rule`, `detector`, `scope` | The rule's id, its detector kind (`null` for a touch rule) and its `scope`. |
| `rules[].status` | `passed`; `failed` (an example failed, or the rule is over `--max-rate`); `no-examples`; `not-run` (an `llm` rule, which runs only when named, because it costs money); `touch` (a named touch rule: nothing to test). |
| `rules[].examples` | Without `--against`, when examples ran: `outcomes`, and `precision` and `recall` over the `good` and `bad` examples. Otherwise `null`. |
| `rules[].against` | With `--against`, when the rule ran (below). Otherwise `null`. |

### An outcome

| Field | Meaning |
|---|---|
| `kind`, `index` | `good`, `bad` or `baseline`, and the 0-based position in that list: `bad[1]`. |
| `path` | The example's `path`. |
| `passed` | `true` exactly when `failures` is empty. |
| `expected` | `{ "fires": false }` for `good`. `{ "fires": true }` for `bad`, with `count` and `lines` when its `expect` pins them. `{ "new": [...], "preexisting": [...] }` for `baseline`. |
| `findings` | What the rule found, passing or not: `line`, `endLine`, `column`, `text` (what the detector matched), `message`. One per match, not merged. A baseline example's findings also have `status`: `new` or `preexisting`. |
| `failures` | Why the example failed, one sentence each, such as `expected lines [2, 4], found [2]` or `line 3: expected new, was pre-existing`. The wording can change; `passed` cannot. |
| `error` | Present when the detector failed or timed out on the example. The example fails. |
| `fix` | Only on a `bad` example of a rule with a [`fix`](rule-format.md#fixes), when the rule caught it as expected and the fix was applied: `{ "passed": true }`, or `{ "passed": false, "reason": ... }` with `reason` `stillFires` (the rule fires on the fixed code), `unresolved` (a fix left its own finding and was undone) or `differs` (the result is not the example's `fixed`; `diff` holds the diff from `fixed` to what the fix produced). A failed fix also adds a sentence to `failures`. Added without a `schemaVersion` bump: it is a new field. |

### `against`

```json
{
  "paths": ["."],
  "matchingFiles": 120,
  "violatingFiles": 70,
  "violations": 212,
  "rate": 0.5833333333333334,
  "maxRate": 0.5,
  "exceeded": true,
  "smallSample": false,
  "files": [{ "file": "backend/app/a.py", "count": 31 }]
}
```

| Field | Meaning |
|---|---|
| `paths` | The `--against` paths, as given. |
| `matchingFiles` | Files under the paths that the rule's own `files` and `exclude` match: the denominator. |
| `violatingFiles`, `violations` | Matching files with at least one finding, and the findings in them. |
| `rate` | `violatingFiles / matchingFiles`; `null` when no file matches. |
| `maxRate` | The `--max-rate` given, or `null`. |
| `exceeded` | `rate` is over `maxRate`, and `smallSample` is `false`. This is what fails the rule. |
| `smallSample` | Under 25 matching files. `--max-rate` is not applied: a share of a handful of files says nothing about the rule. |
| `files` | Every violating file with its count, worst first. |

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
      "suppressAttempted": 0,
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
| `blocked` | Of those, findings that kept a stop from going through at least once. In unattended mode that includes the final stop that holds the agent to report what is left, and leaves out a finding that has already blocked twice and so no longer blocks. |
| `refused` | Findings a refused write rested on, or a shell write the agent was told to revert. |
| `fixed` | Gone at a later check that ran the rule on the file: an edit check or a stop. |
| `ignored` | Still there at a stop when the log ends: the agent was allowed to stop with it, after the stop gate's blocks ran out or because it is a warning. |
| `suppressed` | Dropped by a `rulecast-ignore` comment. That includes a comment on the finding's own line that changed its id, which happens when the match is the whole line, as with `llm` rules. |
| `suppressAttempted` | Findings the agent wrote a `rulecast-ignore` comment for that silenced nothing, because in unattended mode an ignore the agent adds does not count. They stay findings, so they are counted in the other keys as well, never as `suppressed`, and not in `suppressionRate`. |
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
