---
"@syv-ai/rulecast": minor
---

`rulecast run` has a stable output contract that scripts and agent loops can rely on. It is written down in `agents/reference/output.md`.

- **Every finding has an `id`.** It is a hash of the rule, the file and the matched text, not the line, so the same violation keeps its id when lines are added above it. That lets a loop tell "the same finding as last run" from a new one. Findings also carry `endLine`.
- **The JSON has `schemaVersion: 1` and `complete`.** It also lists pre-existing findings in full under `preexisting`, and ignored findings carry their `id`. Adding a field leaves the version alone; removing, renaming or changing one bumps it.
- **The SARIF is richer.** Each result has `partialFingerprints` (the id), `baselineState` (`new`, or `unchanged` for pre-existing findings, which are now included so code scanning does not read them as fixed) and `endLine`. Each rule in `tool.driver.rules` has its name, description, severity, and help text taken from the doc sections it cites. `invocations` says whether the run was complete.

**Breaking:**

- **Exit codes changed** for `run` and `try-repo`: `0` clean, `1` new error findings, `2` rulecast could not run, `3` incomplete. A rule that fails to compile, a rule repo that cannot be fetched, a detector that fails and a verify timeout used to exit 2 and hide the findings of the other rules. They now exit 3, with those findings still printed; so does `run --session` when the session had disabled a rule that would have run. `run RULE_ID` is incomplete only over that rule. `try-repo` still exits 2 when the repo it tries cannot be fetched. `3` wins over `1`. The table is in the README and in `rulecast run --help`.
- **A config file that does not load** (bad YAML or schema, `minimum_rulecast_version` too new) is now an error on stderr with exit 2 and nothing on stdout, instead of a report that checked nothing. Agent hooks still warn, as before.
- **`Finding` has two new required fields**, `id` and `endLine`. An adapter or tool that builds `Finding` values itself must set them.
- The session store's `fingerprint` record is renamed `container`. A session that is running while rulecast is upgraded ignores its old records and classifies `scope: container` rules by line until it measures them again.
