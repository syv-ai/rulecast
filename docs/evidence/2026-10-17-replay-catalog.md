# Replaying this repository's sessions against the catalog, 2026-10-17

Plan 17, Task 7. `rulecast replay claude-code` was run over every Claude Code session recorded for this
repository, with all 20 catalog rules turned on. The question was whether replay works on real
transcripts, and what the catalog would have told the agents working here.

**Result: replay works on real transcripts, and the catalog would have said almost nothing.** It
judged 426 edits and 71 turns from 19 sessions in 1.4 s. One rule fired, on one edit and the turn
that ended with it, and it was right: `loop-safety/protected-loop-config` flagged a Write to
`.rulecast-config.yaml`. That rule is meant for unattended loops, and this was an attended session
where editing the config was the task. As a warning it would not have blocked. No other rule fired.

**What this shows and does not.** It shows the reader handles transcripts from Claude Code 2.1.296 at
real size (up to 10 MB), with subagents. It does not measure precision: two findings on one edit are
too few. The catalog is mostly Python and React rules, and this repository is TypeScript. Of the 20
rules, only five loop-safety rules ever matched an edited file. A second repository, as the plan
asked, was not replayed: none other on this machine has a rulecast config, and writing one into
another project's working tree was left for the developer to decide.

## Setup

- The repository's `.rulecast-config.yaml` was replaced, for the run only, by one listing every rule in
  `.rulecast-rules.yaml` from this repository at `v0.6.0`. It was restored afterwards.
- `rulecast replay claude-code --sessions 50` from the repository root, so every one of its 19 sessions.
- Transcripts under `~/.claude/projects/-Users-nicolaibthomsen-repos-agentic-linting/`.

## Numbers

| | |
|---|---|
| Sessions | 19 |
| Edits judged | 426 |
| Edits not judged (the file before them is not in the transcript) | 76 |
| Turns judged | 71 |
| Wall time | 1.4 s |

| Rule | Edits fired | Turns fired |
|---|---:|---:|
| `loop-safety/protected-loop-config` | 1 of 1 | 1 of 1 |
| `loop-safety/no-new-suppressions` | 0 of 242 | 0 of 14 |
| `loop-safety/no-skipped-tests-ts` | 0 of 106 | 0 of 12 |
| `loop-safety/no-config-suppressions-js` | 0 of 4 | 0 of 2 |
| `loop-safety/no-lowered-thresholds` | 0 of 4 | 0 of 2 |

`loop-safety/no-deleted-assertions-ts` matched edited files but was not run: it is `scope: removed`,
which counts what a file keeps against a baseline count, and replay does not take one. The other 14
rules matched no file these sessions edited.

## What replay cannot see

- **Edits it cannot rebuild.** About one Edit in three records no `originalFile`. Replay then uses
  what the same transcript last wrote or fully read of the file. 76 edits had neither: 39 in main
  transcripts and 37 in subagents', each of which starts with no file seen. An Edit whose
  `oldString` is not in the content replay holds, because a Bash command changed the file in between,
  is not judged either. Nor is a Write over a file never shown, though its content is kept for later
  edits.
- **Edits made through Bash.** A transcript has the command, not what it changed.
- **Rules that need files on disk**, such as a `command` script or a whole-project tool, and
  `scope: removed` rules. These are named in the output, not run.
- **Line attribution.** It is the hook's own: a deletion marks the line after it as changed
  (`core/baseline/changes.ts`), so a pre-existing violation right below a deleted line is reported
  as new. Replay reproduces this, as it should, and the hooks do it too.
