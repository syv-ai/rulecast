---
"@syv-ai/rulecast": minor
---

The `linter` detector supports gitleaks, for hard-coded secrets: `linter: { tool: gitleaks }`, optionally narrowed with `rules: [aws-access-token, ...]`. It runs on edits as well as verify, reads staged content on stdin, and honours the project's `.gitleaks.toml`, `.gitleaksignore` and `gitleaks:allow` comments. A gitleaks finding's `{{text}}` is always `[redacted]`, so the secret is never repeated into an agent's context, a log or SARIF.
