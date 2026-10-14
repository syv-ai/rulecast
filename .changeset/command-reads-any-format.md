---
"@syv-ai/rulecast": minor
---

`command` rules carry `{{message}}`, `{{ruleId}}` and `{{severity}}` for every finding, from whatever the tool reported. A SARIF finding's `{{ruleId}}` is its `ruleId` and its end column is kept.

**Changed:** a `command` finding's `{{text}}` is now the source at the finding's range, as for `linter` rules. Before, a SARIF finding's `{{text}}` was the tool's message; use `{{message}}` for that. A JSON result's own `text` field still wins.

SARIF results that passed, did not apply or were suppressed are no longer findings, and a uri relative to a `uriBaseId` the run declares is resolved against it. Empty output is no findings in every format.
