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
rules, only five loop-safety rules ever matched an edited file. A second repository, a Python
backend with a React frontend, was replayed afterwards with the developer's go-ahead; see
[Second repository](#second-repository). It had one session, so it adds little to this.

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
  `scope: removed` and `scope: container` rules. These are named in the output, not run.
- **Line attribution.** It is the hook's own: a deletion marks the line after it as changed
  (`core/baseline/changes.ts`), so a pre-existing violation right below a deleted line is reported
  as new. Replay reproduces this, as it should, and the hooks do it too.

## Second repository

`~/Dash/ft-abonnementservice`: a Python backend under `backend/app` and a React frontend under
`frontend/`, at `ee7701f`. It has no rulecast config, so one listing the same 20 rules at `v0.6.0` was
written for the run and deleted after it. `git status` was empty before and after.

`rulecast replay claude-code --sessions 50 --llm --yes`. The repository has one recorded session and
no subagents. Without `--yes`, `--llm` reported 0 billed model calls, and none were made: the one llm
rule, `python/thin-routes`, matched no edited file.

| | |
|---|---|
| Sessions | 1 |
| Edits judged | 19 |
| Edits not judged (the file before them is not in the transcript) | 6 |
| Turns judged | 3 |
| Wall time | 0.4 s |

| Rule | Edits fired | Turns fired |
|---|---:|---:|
| `loop-safety/no-new-suppressions` | 3 of 14 | 1 of 1 |
| `loop-safety/no-skipped-tests-python` | 0 of 7 | 0 of 1 |
| `python/no-silent-except` | 0 of 14 | 0 of 1 |

`loop-safety/no-deleted-assertions-python` matched edited files but was not run (`scope: removed`).
No errors. The other 16 rules matched no file the session edited: it worked in `backend/app/enrichment`,
`ingestion` and `models`, in tests and in docs, and not in `api/`, `crud/`, `services/` or the
frontend.

**Findings.** `no-new-suppressions` reported 7 lines, once at the edit and again at the end of the
turn. All 7 were checked against the transcript, and all 7 are what the rule describes: a suppression
the agent added.

- `backend/app/enrichment/parts.py:85`, `# type: ignore[arg-type]`, on a string passed where a
  `Literal` is expected.
- `backend/tests/unit_tests/enrichment/test_enricher.py`, five lines of
  `e._json = fake  # type: ignore[assignment]`, stubbing a client in tests. The file already had one
  such line before the session. Replay matched it to the old one and did not report it, which is
  right.
- `backend/tests/integration_tests/enrichment/test_enrich_document.py:27`, `# ruff: noqa: E501`,
  inside a list comprehension. A later Edit in the same session rewrote the query and removed it.

As in this repository, the session was attended, and the rule is meant for unattended loops. As
warnings they would not have blocked. Seven findings from
one rule in one session say the rule matches what it should. They are too few to say anything about
precision across the catalog.

**What it adds.** Replay ran on a second project, on Python files, and the Python rules matched.
`python/thin-routes` would not have matched even a route edit in this repository: its `files` is
`^app/(api|routers)/`, anchored at the repository root, and here the app is under `backend/`. A
project laid out like this has to set `files` on that entry in its config.
