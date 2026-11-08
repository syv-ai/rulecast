---
type: regex
pattern: '^# rulecast config: https://github\.com/syv-ai/rulecast\nrepos: \[\]\n$'
target: { source: file, path: .rulecast-config.yaml }
---
