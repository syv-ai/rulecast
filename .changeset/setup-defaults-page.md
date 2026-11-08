---
"@syv-ai/rulecast": minor
---

Setup shows a page of defaults drawn from the repository, then asks only the open questions.

- `init --dry-run --format json` reports what setup used to gather by hand: `detected.committers` (distinct authors in the last six months, bots left out; null when there are none or the clone is shallow), `detected.packages` (declared workspaces and top-level directories with a manifest, with their stack and whether they have an agent doc or config), `detected.sessions` (agent settings below the project), `detected.gitHooks` (pre-commit, lefthook, husky, and whether rulecast is in each) and `detected.ci` (workflows that run a coding agent).
- It also reports `generated` and `vendored` paths (generator headers, `linguist-generated`, `linguist-vendored`, `vendor/` and `third_party/`) that the catalog rules' defaults don't already cover: a directory, a `.gitattributes` pattern as one path when it selects exactly the files git marks (git resolves the attributes, negation included), or files one by one (past 20, `notListed` counts the rest; Markdown is never header-scanned). They are offered only when the loaded catalog has `generated-code` or `vendored-code` to adopt them with. It also reports `catalog`: each catalog rule with how many of the project's files it matches, whether it is metered or in a pack, and whether it is configured.
- The dry run fetches the catalog's rule data at its latest tag (or the config's pin), waiting at most 5 s for the tag list. Offline, it uses the newest catalog already cached and says so; otherwise it reports `catalog: { error }` and still exits 0.
- New `init` flags: `--catalog id,id` adopts catalog rules, and `--generated path,path` and `--vendored path,path` add `generated-code` and `vendored-code` with `files` widened by those paths. Each takes only what the dry run offers, and `--catalog` refuses a pack and each rule in one. Catalog rules are now offered at setup; `rulecast add` and `list --catalog` stay for adopting them later.
- New catalog rule `vendored-code`: edits under `vendor/` and `third_party/` are errors, with a message to update the dependency and re-vendor it.
- SETUP.md's six-question interview is replaced: the agent fills the setup page with defaults from init's report and its own reading, asks the questions only the developer can answer (llm rules, agent loops with nobody watching) in the same turn, and writes after one approval. The setup page numbers every item, marks its state (default, said, off, struck) and has a "Needs your answer" section.
- All new work runs in `init`, which is not a hook: the edit-hook latency budget is unaffected.

Breaking:

- The setup page's `said` field is now `value`, and its items carry `n` and `state`. CONVENTIONS.md's review page uses `value` and `state: "said"`.
- SETUP.md's interview is replaced by the page of defaults.
- `init --format json` has new fields (`detected.committers`, `packages`, `sessions`, `gitHooks`, `ci`, and `generated`, `vendored`, `catalog`), and a dry run now loads the catalog.
- `RuleSelection` (internal) gains `files`. `remoteTags` (internal) takes a timeout, and `loadCatalog` can fall back to the cache.
