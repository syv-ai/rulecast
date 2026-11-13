# rulecast stats and replay

What `rulecast stats` and `rulecast replay` print with `--format json`: what agent hooks recorded in past sessions, and what today's rules would have said in them. Exit codes and the shared fields, such as finding ids, are in [output.md](output.md). How a person reads the weekly trend is in [Reading the trend](../../guides/agents.md#reading-the-trend).

Relative links in this file resolve against this file's own URL.

## rulecast stats

`rulecast stats --format json` says, per rule, what became of the findings agent hooks reported: whether the agent fixed them, kept being blocked on them, or silenced them. A loop that improves rules reads it to find rules that are noisy and rules that never fire.

```sh
rulecast stats --since 30d --format json    # 30d, 12h or a date; default: everything in the log
rulecast stats --worktrees '*' --format json   # every checkout of the repository; a glob over their directory names picks some
```

A date alone, such as `2026-09-01`, is midnight UTC. A date with a time needs its offset, as in `2026-09-01T10:00Z` or `2026-09-01T12:00+02:00`; without one it is refused, as is a date that does not exist. For `weekly`, `--since` rounds down to the Monday of its week, so the trend holds whole weeks.

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
  "neverRan": ["frontend/no-generated-edits"],
  "runs": { "backend/no-httpexception": 4, "frontend/no-generated-edits": 0 },
  "stopBlocks": [
    {
      "rule": "backend/no-httpexception",
      "byFiles": [
        { "files": "1", "stops": 2, "blocked": 1 },
        { "files": "2-5", "stops": 0, "blocked": 0 },
        { "files": "6+", "stops": 0, "blocked": 0 }
      ]
    }
  ],
  "unknownRules": [],
  "weekly": {
    "from": "2026-10-01T10:00:00.000Z",
    "rolledUpTo": null,
    "summary": "off",
    "rules": [
      {
        "rule": "backend/no-httpexception",
        "fired": 1,
        "enoughFindings": false,
        "weeks": [
          { "week": "2026-09-28", "runs": 3, "sessions": 1, "fired": 1, "firedPer100Runs": null, "partial": true },
          { "week": "2026-10-05", "runs": 1, "sessions": 1, "fired": 0, "firedPer100Runs": null, "partial": true }
        ],
        "recurringFiles": [],
        "recurringFileCount": 0
      }
    ]
  }
}
```

| Key | Meaning |
|---|---|
| `schemaVersion` | The version of this shape. It is versioned apart from `run`'s document, under the same [policy](output.md#version-policy). |
| `window.since` | The `--since` cut-off, or `null` for everything in the log. Only findings first reported at or after it are counted. |
| `window.firstRecord`, `window.lastRecord` | The oldest and newest record in the log, or `null` when it is empty. |
| `window.truncated` | The log has been rotated and does not reach back to `since`, so older findings may be missing. |
| `sessions` | Agent sessions with a record in the window. |
| `rules` | One entry per rule with a finding in the window, most fired first. |
| `neverFired` | Enabled detector rules in the current config with no finding in the window. Touch rules are left out, since they never report findings. Left out when anything in the config did not compile (see `notCompiled`). |
| `neverRan` | Of `neverFired`, the rules no check ran at all in the window: their `files` matched nothing the agents changed. A rule that ran many times and never fired has not been broken; one that never ran may have a `files` pattern that is wrong. Left out with `neverFired`. |
| `runs` | Per enabled detector rule in the config, how many edit checks and stops in the window ran it to completion on at least one file. Left out with `neverFired`. |
| `stopBlocks` | Per rule that blocked a stop in the window, its stops by how many files it judged there (`1`, `2-5`, `6+`), and how many of those it blocked. A block rate that climbs with the number of files, whatever they hold, is a rule that is sometimes wrong: each file is one more chance to block. Left out with `neverFired`. |
| `unknownRules` | Rules with findings in the window that are no longer in the config: removed, or renamed. Left out when anything in the config did not compile. |
| `notCompiled` | What in the config did not compile, such as a rule repo that has not been fetched (`rulecast install`) or a rule with an error. Present only when there is something. The rules it would have given are unknown, so `neverFired`, `neverRan`, `runs`, `stopBlocks` and `unknownRules` would be wrong and are left out. The same lines go to stderr. |
| `weekly` | Per rule, its findings by week, to see over weeks whether it fires less. Always present. |
| `weekly.from` | The first instant the trend covers: the oldest record it counts, or the Monday of `since`'s week when that is later. `null` with no data. |
| `weekly.rolledUpTo` | The newest record the weekly summary counts, or `null` when there is no summary. |
| `weekly.summary` | `"on"` when this config keeps a weekly summary (`stats.weekly_summary: true`), else `"off"`. With it off, the trend covers only what the log holds, plus any summary written while it was on. |
| `checkouts` | Only with `--worktrees`: the checkouts whose logs were read, each `{ "name", "root", "exists", "records" }`. `name` is the checkout's directory name, `root` this project's directory in it, `exists` false for a checkout removed since whose log is still cached, and `records` how many lines its log holds (0: nothing logged there). Findings in different checkouts are kept apart, even in one session; `sessions` counts each session once. |
| `skippedLines` | Lines of the log or the weekly summary that could not be read, or that were not a whole record. Present only when there were any. |

Per rule, every count is of findings, and a finding is counted once per session however many times it was reported (in `weekly`, once per session and log file):

| Key | Meaning |
|---|---|
| `fired` | Findings first reported in the window. |
| `blocked` | Of those, findings that kept a stop from going through at least once. In unattended mode that includes the final stop that holds the agent to report what is left, and leaves out a finding that has already blocked twice and so no longer blocks. |
| `refused` | Findings a refused write rested on, or a shell write the agent was told to revert. |
| `fixed` | Gone at a later check that ran the rule on the file: an edit check or a stop. |
| `ignored` | Still there at a stop when the log ends: the agent was allowed to stop with it, after the stop gate's blocks ran out or because it is a warning. |
| `suppressed` | Dropped by a `rulecast-ignore` comment. An id leaves a trailing `rulecast-ignore` out of the line it hashes, so a comment on the finding's own line keeps its id; for a match whose id hashes its text (a redacted or whole-file one), the same rule ignored on the line the finding was last reported on counts too. |
| `suppressAttempted` | Findings under a `rulecast-ignore` comment the agent added or changed that silenced nothing: in unattended mode an ignore does not silence a finding on a line changed this session. Code the agent changed under a comment it left alone is not silenced either, but is not an attempt. They stay findings, so they are counted in the other keys as well, never as `suppressed`. They do count towards `suppressionRate` and `noisy`: the agent wanted them silenced. |
| `prevented` | Only ever reported on refused writes, and the agent's next stop came without it: the agent gave up on the write, so the violation never reached the file. A refused finding that a later check of its file finds gone is `fixed` instead. |
| `open` | Still there, and no stop has seen it yet: the session is still going, or it ended without a stop. Never counted as ignored. |
| `repeated` | Still there at two or more stops, or refused twice or more: the agent kept hitting it instead of fixing it. |
| `medianTurnsToFix` | Over the fixed findings, how many of the agent's stops came between the first report and the fix. `0` is fixed in the same turn. `null` when none was fixed. |
| `repeatRate`, `suppressionRate` | `repeated / fired` and `(suppressed + suppressAttempted) / fired`, to two decimals; a finding in both counts once. |
| `noisy` | `"repeats"` when a rule has fired at least 5 times and at least 30% of its findings repeated; `"suppressed"` when it has fired at least 5 times and its `suppressionRate` is at least 20%: suppressed, or, unattended, under an ignore the agent added or changed. A noisy rule's message may not say how to fix it, or its pattern may be too broad. |

`weekly.rules` lists the rules with a finding in the trend's weeks, most fired first. Weeks start on Monday at 00:00 UTC. They run from the first week with data to the week of the newest record, with zeros for weeks without any:

| Key | Meaning |
|---|---|
| `fired` | Findings first reported in the trend's weeks, counted as in the table above. |
| `enoughFindings` | `fired` is at least 10. Below that the trend says little. |
| `weeks[].week` | The week's Monday, as `YYYY-MM-DD`. |
| `weeks[].runs` | Edit checks and stops that week that ran the rule on at least one file. It is the same count as the top-level `runs`, so rules that run only at a stop (hook rules) have a denominator too. |
| `weeks[].sessions` | Sessions with such a check that week. |
| `weeks[].fired` | Findings of the rule first reported that week. |
| `weeks[].firedPer100Runs` | `fired * 100 / runs`, to one decimal. `null` when the rule ran fewer than 20 times that week: below that, one finding moves the rate by more than 5. |
| `weeks[].partial` | The data does not cover the whole week: it starts after the week's Monday, or ends before the next one. The current week is always partial. A week with no data at all (no rule has a check that week) is partial too, and its zeros mean no data, not no findings: rulecast recorded nothing, or the log rotated past that week while the summary was off. |
| `recurringFiles` | Files the rule fired on in 3 or more sessions, most sessions first, then by path; at most 10. |
| `recurringFileCount` | How many files are recurring, the ones past the first 10 included. |

The floors (20 checks a week, 10 findings, 3 sessions) are first guesses, to be tuned from use.

Things to know when reading the counts:

- A finding's identity is its [id](output.md#finding-ids), which hashes its source line. So any edit to that line, fixing it or not, counts as one fixed finding and one new one, unless the edit only adds a trailing `rulecast-ignore`.
- A finding the context budget kept out of a delivery still counts as reported.
- Only agent hooks write the log. `rulecast run`, git hooks and CI do not, and findings that were there before the session or are in files the user changed during it are not counted.

### The findings log

The counts come from `findings.jsonl` in the project's directory of the rulecast cache (`rulecast doctor` prints where). There is one log per config and checkout: each config runs as its own project, and the directory is keyed by the config's real path. Agent hooks append one record per edit check, refused write and stop. A record holds finding ids, rule ids, file paths and line numbers, and never the message, the matched text or a capture, so no code is written to it. It never leaves the machine.

The log keeps about the newest 8 MiB and drops older records: about a week for a loop that writes a record every 20 seconds around the clock, and weeks for a developer working by hand. A hook never fails because the log could not be written. `rulecast clean` removes it with the rest of the cache.

With `stats.weekly_summary: true` in the config (off by default), the per-week counts of the records the log drops are kept in `findings-weekly.jsonl` beside it, for 26 weeks. It holds rule ids, file paths, weeks and counts only. Only the config that turns it on keeps one: configs below it do not inherit the key. `rulecast clean` removes it too.

Its format is internal and can change in any release. The `stats` JSON above is the contract.

## rulecast replay

`rulecast replay claude-code --format json` says what the configured rules would have told the agent in this project's recent Claude Code sessions. It reads the session transcripts under `~/.claude/projects` (or `CLAUDE_CONFIG_DIR`) and judges each Edit and Write on what it changed, as the edit hook does, and each turn on what it changed from its first edit of a file to its last, as the stop does. Content comes from the transcript alone. Nothing is written to the findings log, so `stats` never counts a replay.

```sh
rulecast replay claude-code --sessions 20 --format json   # --rule ID (repeatable); --llm, then --llm --yes
```

```json
{
  "sessions": 19,
  "edits": 426,
  "turns": 71,
  "unknownEdits": 76,
  "rules": [
    { "rule": "loop-safety/protected-loop-config", "severity": "warning", "edits": 1, "editsFired": 1, "turns": 1, "turnsFired": 1, "wouldBlock": 0 }
  ],
  "findings": [
    { "session": "77882c8a-…", "agent": "main", "turn": 1, "stage": "edit", "rule": "loop-safety/protected-loop-config", "file": ".rulecast-config.yaml", "line": 1, "message": ".rulecast-config.yaml configures the checks that judge this run. …" }
  ],
  "skippedRules": ["loop-safety/no-deleted-assertions-ts"],
  "errors": []
}
```

| Key | Meaning |
|---|---|
| `sessions`, `edits`, `turns` | Sessions read, newest first (`--sessions`, default 20), and the edits and turns judged in them, subagents' included. |
| `unknownEdits` | Edits whose file before them the transcript never showed: about one Edit in three records no `originalFile`, and then replay uses what the same transcript last wrote or fully read. These are not judged. |
| `rules[]` | Per rule that ran: `edits` and `turns` it was run on, those it found something new in, and `wouldBlock`, the turns whose stop an `error` finding would have blocked. |
| `findings[]` | Every new finding. `turn` counts from 0, from the agent's first prompt. `stage` is `edit` (the edit hook would have told the agent) or `turn` (the stop would have). `agent` is `main` or a subagent's id. |
| `skippedRules` | Rules that would have run but cannot from a transcript: their tool needs the files on disk (a `command` script, a whole-project tool), or their `scope` is `removed` or `container`, which judge against measurements of the file before the session that a replay does not take. |
| `errors` | Rules whose detector failed or timed out, with the first message. They stop being run. |

`llm` rules are left out unless `--llm` is given. With `--llm` alone, the document is `{ "estimate": { "calls": N } }`: one model call per file per event judged, and nothing is run. `--llm --yes` runs them. Edits made through Bash are not in a transcript and are not judged. The command exits 0 whatever it finds, and 2 on a usage error or a config that does not load.
