---
"@syv-ai/rulecast": minor
---

Biome is now a supported linter, and `rulecast init` reports the linters and CI systems it finds but can't use (#75, #76).

- **Biome:** `detect: { linter: { tool: biome } }` delivers what the project's `biome.json` makes an error. `rules: [suspicious/noDebugger]` turns on named rules, with ids written as in `biome.json`; a bare name such as `noDebugger` is refused, since Biome reports `group/rule` and it would never match a finding (in `context_by_rule` too). rulecast runs `biome lint --reporter=rdjson` and links each finding to Biome's page for the rule. `init` offers it when `biome.json` or `biome.jsonc` is there and Biome is installed. It can't say which rules the config makes errors, so it shows no count. A pre-commit hook `biome-check`, `biome-lint` or `biome-ci` is marked as the same as the linter rule.
- **Linters that are not offered:** `init --dry-run` lists them under `linters.unoffered`, and the text output names them. That covers a linter rulecast doesn't support (golangci-lint, RuboCop, stylelint, flake8, Pylint, Clippy, markdownlint, hadolint, ShellCheck), which a `command` rule can run, and a supported linter whose config is there but which isn't installed. Before, both were left out without a word.
- **CI:** `detected.ci` now lists every CI config by system: `github-actions`, `azure-pipelines` (including templates in `.azure-pipelines/`), `gitlab-ci`, `circleci`, `bitbucket-pipelines` and `jenkins`. `agent` names the coding agent a config runs, or is `null`. Before, it listed only GitHub workflows that run an agent, so an Azure Pipelines repository read as having no CI. Breaking: `ci` entries now carry `system`, and `agent` may be `null`.
