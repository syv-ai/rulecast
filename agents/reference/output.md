# rulecast output contract

What a script, a CI job or an agent loop can rely on from `rulecast run` and `rulecast try-repo`: the exit code, the JSON document and the SARIF log. [`rulecast test`](#rulecast-test) and [`rulecast list`](#rulecast-list) have their own documents below, and `rulecast stats` and `rulecast replay` theirs in [stats.md](stats.md). The terminal and `agent` formats are for people and agents to read, and can change in any release.

Relative links in this file resolve against this file's own URL.

```sh
rulecast run --from-ref origin/main --format json    # or --all-files, --files F..., staged by default
rulecast run --from-ref origin/main --format sarif   # for GitHub code scanning
```

`rulecast run --files F...` judges the files it is given whole, like `--all-files`: every finding in them is new unless a [committed baseline](#committed-baseline) lists it.

## Exit codes

| Code | Meaning | stdout |
|---|---|---|
| `0` | Every rule ran; no new error-severity findings (warnings and pre-existing findings allowed) | the report |
| `1` | Every rule ran; at least one new error-severity finding | the report |
| `2` | rulecast could not run: usage, a config file that does not load, git, or an internal error | empty; the message is on stderr |
| `3` | Incomplete: a rule failed to compile, a rule repo could not be fetched, a detector failed or timed out. Findings that were produced are still reported. Wins over 1 | the report, with `complete: false` |

A config file does not load when its YAML, its schema or its `minimum_rulecast_version` fails. With `--session`, `3` also covers a rule whose detector failed earlier in that session, which disabled it. `3` wins over `1` because a `1` promises that every rule ran. A loop can stop on `0`, fix and retry on `1`, and needs a person on `2` or `3`.

`rulecast run RULE_ID` is incomplete only over that rule: its own compile error, or a rule repo that failed and configures it. Another repo that could not be fetched is still a warning, but not a `3`.

`try-repo` fetches the repo it tries before anything runs, so a repo that cannot be fetched, or has no manifest, exits `2`.

These are not incomplete, because they are limits the project set rather than failures: a staged run skipping `llm` rules (listed in `skipped`), `llm` rules over `llm.max_files_per_verify` (a warning names the files), and a whole-project rule skipped in a staged run because its files differ from the working tree (a warning). Read `warnings` and `skipped` to see them.

Other commands keep their own codes: `validate` and `doctor` exit 2 on the problems they find, `test` 1 on a failed example or a rule over `--max-rate` ([below](#rulecast-test)), and `baseline` 3 when a rule could not run (without `--prune` it then writes nothing). `rulecast init --format json` is for setup agents, not a contract: its shape may change in any release.

## Several projects

With several configs ([Several configs](rule-format.md#several-configs)), the output is one document, and the exit code is the highest any project gives.

Paths in the output are relative to the directory `run` was started in, with `/` separators. Outside a git repository they are relative to the project root. With several projects, a warning or notice starts with the path of the config it came from, and a rule id that two configs define differently is shown as `<id> (<config dir>)` on its findings.

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
| `references` | The doc sections the new findings' rules cite, with their text when it was read ([A reference](#a-reference)). |
| `warnings` | rulecast's own problems other than the rules in `disabled`, one string each: a timeout, an ignore without a reason (`"app/a.py:2: rulecast-ignore needs a reason after the rule id; the finding was kept"`), a file budget. Not findings. |
| `skipped` | The ids of the `llm` rules a staged run or `--no-llm` left out, when they matched a checked file: `["app/judge"]`. |
| `disabled` | Rules that did not run, grouped by why: `[{ "reason": "…: not in the cache (run rulecast install)", "rules": ["python/no-bare-except"] }]`. A rule repo that could not be fetched, a detector whose tool is missing, a rule that failed to compile, and with `--session` a rule the session disabled that would have run here. Each rule is named once, here and not again in `warnings`. With `RULE_ID`, only what concerns that rule. Empty when every rule ran. When it is not empty, `complete` is `false` and the exit code is 3. |
| `checked` | How many files were checked and how they were chosen: `staged`, `range`, `all`, `files` or `session`. |
| `ignored` | Findings a `rulecast-ignore` comment dropped: `id`, `rule`, `file`, `line`, `reason`. |
| `touches`, `notices`, `stop` | Agent-session fields; empty or `null` from the CLI. |
| `baseline` | When the run classified against the committed baseline: `{ "file": ".rulecast/baseline.json", "entries": 412, "matched": 372, "stale": 40 }`. `entries` is how many ids the file lists, `matched` how many of this run's findings it made pre-existing, `stale` how many entries the run showed are gone (fixed, or the text changed). `null` when the run used no committed baseline. Never changes the exit code. With several projects, `baselines` takes its place: one `{ "root": "backend", "baseline": … }` per project, nearest first, `root` relative to where `run` was started and `baseline` as above. |

### A finding

| Field | Meaning |
|---|---|
| `id` | A stable id for the finding (below). 16 hex characters. |
| `rule` | The rule's id, or its alias when it has one. |
| `severity` | `error` or `warning`. |
| `status` | `new` or `preexisting`. |
| `file` | Relative to the directory `run` was started in ([Several projects](#several-projects)), with `/` separators. |
| `line`, `endLine`, `column` | 1-based. `endLine` is the last line of the match. |
| `message` | The rule's `message` with its template variables filled in. |
| `count` | How many matches this finding stands for. Findings of one rule in one file with the same rendered message are merged into one; that only happens when the message has no `{{line}}`. A merged finding shows its earliest match, and carries that match's id. |
| `captures` | The values the message template names, when it names any. |
| `fixable` | `true` when `rulecast fix` can apply this rule's fix; absent otherwise. Route these to `rulecast fix`, the rest to an agent. |
| `docs` | What the finding's lint rule points to: `{ "ref": "docs/x.md#y" }`, the project's section for it from the rule's `context_by_rule`, else `{ "url": "…" }`, the tool's own page for it. Absent when there is neither. |

### A reference

| Field | Meaning |
|---|---|
| `ref` | The section, as `file#anchor`. |
| `state` | `full`: its text is in `content`. `pointer`: it was delivered earlier in this agent session. `read`: not included; read it before going on. `missing`: it could not be found. |
| `content` | The section's text. Only with `full`. |
| `reason` | Why a `read` section was left out: `mode` (its reference has `mode: read`), `budget` (the message had no room left) or `tooLarge` (it is over `context.max_bytes`). Only with `read`. |
| `location` | The absolute path of the file to read, for a `read` section from a rule repo. |

### `rulecast fix`

`rulecast fix [RULE_ID] (--files F... | --all-files | --from-ref A) [--dry-run] --format json` prints the same document, for a check of the files after the fixes were written, with these keys added:

| Key | Meaning |
|---|---|
| `dryRun` | Whether `--dry-run` was given. |
| `fixed` | `id`, `rule`, `file`, `line` of each finding a fix was applied to. The id is the one `run` reports on the files as they were, even for a finding fixed in a later pass after another rule's fix changed its line; the line is where it was when its fix was applied. |
| `changedFiles` | The files the fixes changed (or would change). |
| `unresolved` | Findings whose fix left the rule matching the text it wrote: the fix was undone. Same shape as `fixed`. |
| `diff` | With `--dry-run` only: a unified diff of every change. |

The exit codes are `run`'s, from that check: `0` when no new error finding is left, `1` when one is (a rule with no fix, an unresolved fix, a rule whose fix failed its own examples), `3` when a rule did not run, `2` when rulecast could not run. Under `--dry-run` nothing is written, so the check reads the files unfixed and leaves out the findings the fixes would remove: the code is an estimate, and a fix that would create or remove another tool's finding is not seen. A rule whose fix fails its `good` or `bad` examples is named in `warnings`, with the examples that failed; a failing `baseline` example does not stop its fix.

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

A finding about a whole file hashes its text and captures instead of the file's lines, so an edit to the file keeps its id: a `path` rule's finding (its text is the path), and a hook's finding that covers the whole file (it would reformat the file, or failed without a location). Such a finding says it is about the whole file; one that merely spans every line of its file still hashes its lines. A `scope: removed` finding is about its file's count, so it hashes its text and captures too, leaving out its counts (`{{removed}}`, `{{baseline}}`): it keeps its id as more matches go, while its message says the current counts. A secret a tool reports (gitleaks) hashes its redacted text and captures, never its line, so no part of the secret goes into the id; two secrets of one rule in one file are told apart by their order. If the file cannot be read, the matched text is hashed in place of its lines.

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

`--format sarif` prints a SARIF 2.1.0 log with one run per project, each with its own `tool.driver.rules`. With several projects, each run's `automationDetails.id` is `rulecast/<root>/`, the root relative to where `run` was started (`rulecast/` for that directory itself).

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

`artifactLocation.uri` is relative to the directory `run` was started in, in every run. Code scanning needs paths relative to the repository, so run it from the repository's top.

## rulecast test

`rulecast test` runs each rule's examples ([rule-format.md](rule-format.md#examples)); with `--against` it fires each rule over real files instead, and with `--history` it judges one rule on recent commits. It is the gate for a rule an agent drafted: the examples pass, and the rule does not flag most of the files it matches.

```sh
rulecast test <rule-id> --format json
rulecast test <rule-id> --against . --max-rate 0.5 --format json
rulecast test <rule-id> --history --max-rate 0.5 --format json   # --commits N; --yes for an llm rule; --label
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
| `rules[].status` | `passed`; `failed` (an example failed, or the rule is over `--max-rate`); `no-examples`; `not-run` (an `llm` rule, which runs only when named, because it costs money; or, under `--against` or `--history`, a `scope: removed` rule, whose matches are what a file keeps and which has no baseline there to count a drop against); `touch` (a named touch rule: nothing to test). |
| `rules[].examples` | Without `--against`, when examples ran: `outcomes`, and `precision` and `recall` over the `good` and `bad` examples. Otherwise `null`. |
| `rules[].against` | With `--against`, when the rule ran ([below](#against-the-rule-on-real-files)). Otherwise `null`. |
| `rules[].history` | Only with `--history`: what the rule found in recent commits ([below](#history-the-rule-on-recent-commits)), or `null` when it was not run (such as a `scope: removed` rule). |
| `rules[].estimate` | Only with `--history`, for a rule that costs money per file (`llm`) run without `--yes`: `{ "commits", "calls" }`, one model call per file per commit. Nothing was run, and `status` is `not-run`. |

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
| `fix` | Only on a `bad` example of a rule with a [`fix`](rule-format.md#fixes), when the rule caught it as expected and the fix was applied: `{ "passed": true }`, or `{ "passed": false, "reason": ... }` with `reason` `stillFires` (the rule fires on the fixed code), `unresolved` (a fix left its own finding and was undone) or `differs` (the result is not the example's `fixed`; `diff` holds the diff from `fixed` to what the fix produced). A failed fix also adds a sentence to `failures`. |

### `against`: the rule on real files

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

### `history`: the rule on recent commits

`--against` counts what a rule finds in files as they are; `--history` judges it the way a session does: against what a commit changed, at that commit's content, so only what the commit added counts. It takes the newest non-merge commits on `HEAD` that change a file the rule matches (`--commits`, default 20, or 10 for an `llm` rule), and judges each as `rulecast run --from-ref C^ --to-ref C` would. For a rule about a change rather than a whole file, and for an `llm` rule, it is the closer measure.

```json
{
  "commits": 20,
  "commitsFired": 3,
  "rate": 0.15,
  "maxRate": 0.5,
  "exceeded": false,
  "smallSample": false,
  "findings": [
    { "commit": "9f1c…", "subject": "add the export route", "file": "app/api/export.py", "line": 14, "message": "app/api/export.py:14 does work that belongs in a service.", "label": "real" }
  ],
  "labels": { "real": 2, "false": 1, "unlabelled": 0, "precision": 0.67, "file": ".rulecast/history/api__thin-handlers.json" }
}
```

| Field | Meaning |
|---|---|
| `commits` | Commits judged. |
| `commitsFired` | Of those, the commits the rule found something new in. |
| `rate` | `commitsFired / commits`; `null` when there was no commit to judge. |
| `maxRate`, `exceeded` | As under `against`. Not applied when `smallSample` is `true`. |
| `smallSample` | Under 10 commits. |
| `findings` | Every new finding, newest commit first, with the commit's subject and the rule's message. `label` is the developer's mark, when the label file has one. |
| `labels` | From `.rulecast/history/<rule id, / as __>.json`, or `null` when there is no such file. `--label` writes the findings there with `"label": null`, keeping any mark already in it. The developer, or an agent with them, sets each to `"real"` or `"false"`. `precision` is `real / (real + false)` over this run's findings, or `null` when none is marked. |

## rulecast list

`rulecast list --format json` prints an array with one entry per configured rule, catalog rules included: its `id`, `name`, `source` (`local` or the rule repo's label), `enabled`, `stages`, `detector` and `config` (`null` for a touch rule), `severity`, `files`, `exclude`, `matchingFiles` (`null` outside a git repository), `context`, and `contextByRule` when the rule has one. With a rule id it holds that rule alone, with `matching`, `message` and `sections` (each `{ "ref", "content" }`, `content` `null` when the section is not found) added. `--catalog` adds `description`, `pack`, `installed`, `cost` and, with a rule id, `examples`.

The `not_checked` entries are not in it, because they are not rules and the array holds only rules. The terminal output lists them after the rules, with each malformed entry's warning, and a script reads them from `.rulecast-config.yaml` itself.
