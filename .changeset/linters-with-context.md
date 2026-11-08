---
"@syv-ai/rulecast": minor
---

The linters a project already runs can be delivered with their docs. A `linter` rule without `rules` delivers what the project's own ESLint, Ruff, oxlint or gitleaks config makes an error, and each finding says where its lint rule is explained: the project's own section, or else the linter's page for it.

- New rule key `context_by_rule`: maps a lint rule id, exactly as `{{ruleId}}` shows it, to project doc sections, on `linter`, `command` and `hook` rules. A section is delivered only with the findings of its lint rule, and the first such finding in a block says `see <ref>`. A lint rule with no mapping says `upstream docs: <url>` when the tool's output gives one. For Ruff the keys are codes (`B006`); a name is a validate error.
- `rulecast init` detects the linters from their config files, lists how many rules each config makes errors and how many warnings will not be delivered, finds the doc sections that name those rules, and writes one rule per linter with `--linters linter/eslint,linter/ruff`. A pre-commit or lefthook hook that runs one of them says it is the same as the linter rule. init never writes `context_by_rule`: setup proposes each mapping and the developer agrees it.
- `rulecast list` shows each mapping, and SARIF rule help includes the mapped sections.

Breaking changes:

- A `linter` rule without `rules` no longer delivers warnings: only what the project's config makes an error (ESLint level 2, oxlint `error`/`deny`, every rule Ruff selects, every gitleaks finding).
- ESLint runs with `--format=json-with-metadata`.
- Findings in JSON output carry `docs`: `{ "ref": … }` or `{ "url": … }`.
- `context_by_rule` is a new rule key.
