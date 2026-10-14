---
"@syv-ai/rulecast": minor
---

**Breaking for plugin detectors:** `runTool` now resolves to `{ stdout, stderr, exitCode }` instead of the stdout string, so a detector can tell a tool's "found something" exit code from its "I failed" one. Replace `await runTool(...)` with `(await runTool(...)).stdout` to keep the old behaviour. The `ToolResult` type is exported.
