---
"@syv-ai/rulecast": minor
---

Setup shows a page of defaults drawn from the repository, then asks only the open questions.

- `init --dry-run --format json` reports what setup used to gather by hand: `detected.committers` (distinct authors in the last six months, bots left out; null without history), `detected.packages` (declared workspaces and top-level directories with a manifest, with their stack and whether they have an agent doc or config), `detected.sessions` (agent settings below the project), `detected.gitHooks` (pre-commit, lefthook, husky, and whether rulecast is in each) and `detected.ci` (workflows that run a coding agent).
- It also reports `generated` and `vendored` paths (generator headers, `linguist-generated`, `linguist-vendored`, `vendor/` and `third_party/`) that the catalog rules' defaults don't already cover, and `catalog`: each catalog rule with how many of the project's files it matches, whether it is metered or in a pack, and whether it is configured. A catalog that can't be loaded is reported as `catalog: { error }`, and the dry run still exits 0.
- New `init` flags: `--catalog id,id` adopts catalog rules, and `--generated path,path` and `--vendored path,path` add `generated-code` and `vendored-code` with `files` widened by those paths. Each takes only what the dry run offers. Catalog rules are now offered at setup; `rulecast add` and `list --catalog` stay for adopting them later.
- New catalog rule `vendored-code`: edits under `vendor/` and `third_party/` are errors, with a message to update the dependency and re-vendor it.
- SETUP.md's six-question interview is replaced: the agent fills the setup page with defaults from init's report and its own reading, asks the questions only the developer can answer (llm rules, agent loops with nobody watching) in the same turn, and writes after one approval. The setup page numbers every item, marks its state (default, said, off, struck) and has a "Needs your answer" section.
- All new work runs in `init`, which is not a hook: the edit-hook latency budget is unaffected.

Breaking:

- The setup page's `said` field is now `value`, and its items carry `n` and `state`. CONVENTIONS.md's review page uses `value` and `state: "said"`.
- SETUP.md's interview is replaced by the page of defaults.
- `init --format json` has new fields (`detected.committers`, `packages`, `sessions`, `gitHooks`, `ci`, and `generated`, `vendored`, `catalog`), and a dry run now loads the catalog.
- `RuleSelection` (internal) gains `files`.
