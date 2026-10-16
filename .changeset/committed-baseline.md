---
"@syv-ai/rulecast": minor
---

A committed baseline for full-repository runs. `rulecast baseline` runs every rule over every file and writes `.rulecast/baseline.json`, the ids of the findings there are today. Commit it, and `rulecast run --all-files` or `--files` treats those findings as pre-existing and exits 0 unless something new appears. That is the gate a nightly sweep or a scheduled agent loop needs when it has no ref to diff against.

- `rulecast baseline --prune` drops the entries that are no longer found. It never adds one, keeps the entries of rules that did not run, and leaves the file untouched when nothing changed.
- `rulecast baseline --force` rewrites the file. Without it, an existing baseline is not overwritten, so recording new findings is a visible step.
- `rulecast baseline` gives metered (llm) rules every file, past `llm.max_files_per_verify`. With `--no-llm` it names the rules it left out, and `--force` keeps the old entries of every rule that did not run.
- An entry whose rule no longer has the `verify` stage is stale, like one whose rule or file is gone.
- `run` says when entries are no longer found (`baseline: 3 entries no longer found …`), and `--format json` has a new `baseline` key: `{ file, entries, matched, stale }`, or `null`.
- A session, `--from-ref` and a staged commit's `HEAD` keep their own baseline. Agent hooks never read the file.
- `rulecast doctor` reports the baseline's size, when it was added and when it last changed, taken from git.
- `.rulecast/.gitignore` now lets `baseline.json` through. One written by an earlier rulecast is updated the next time it is used, unless it was edited. When another ignore file excludes `.rulecast/`, `rulecast baseline` names the pattern to narrow. And no rule ever checks files under `.rulecast/`.

Where a ref exists, `--from-ref` is still the better baseline: it never needs maintaining.
