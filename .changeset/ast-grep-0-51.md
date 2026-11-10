---
"@syv-ai/rulecast": patch
---

rulecast now uses ast-grep 0.51.1 (was 0.45.3) to run `ast-grep` rules. One change is visible in your rules, and only in Python ones.

In an ast-grep pattern, `$NAME`, `$_NAME` and `$$$NAMES` are metavariables: they stand for whatever code is there. Python support comes from a separate parser, and until now ast-grep treated every `$` in a Python pattern as the start of a metavariable, even where you meant a real `$` character. So a pattern such as `Template("$name")` or `re.compile(r"^\d+$")` never matched anything. Now a `$` that does not start a metavariable is matched as you wrote it, as it already was for TypeScript, JavaScript, CSS and HTML. A Python rule with such a pattern may start reporting matches. Rules that use only metavariables match exactly what they did before.

Nothing else changes for your rules: the parsers for the languages rulecast supports are the same versions, and so are the node kinds a rule can name.
