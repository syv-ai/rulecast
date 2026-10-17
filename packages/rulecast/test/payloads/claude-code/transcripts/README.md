# Claude Code transcripts

What `rulecast replay claude-code` reads (`src/adapters/claude-code/transcript.ts`). Not recordings: real
transcripts hold a whole conversation, so these are written by hand, with exactly the fields and shapes
recorded from Claude Code 2.1.296 on 2026-10-17, over 19 sessions of this repository. The project is
`/project`; the test points it at a fixture.

- `session.jsonl` is a session's main transcript, at `<config dir>/projects/<root, every non-alphanumeric a ->/<session id>.jsonl`.
- `session/subagents/agent-<id>.jsonl` is one subagent it started (`isSidechain: true`, `agentId`).

What was recorded:

| Record | Shape |
|---|---|
| A prompt | `type: "user"`, `message.content` a string (or a list with a `text` part and no `tool_result`), no `toolUseResult`. Injected text has `isMeta: true`; commands, their output and task notifications are prompts too but start with `<`. |
| A complete Read | `toolUseResult: { type: "text", file: { filePath, content, startLine: 1, numLines, totalLines } }`, `numLines === totalLines` |
| Write, new file | `toolUseResult: { type: "create", filePath, content, structuredPatch: [], originalFile: null }` |
| Write over a file | `toolUseResult: { type: "update", filePath, content, structuredPatch, originalFile }`, `originalFile` a string or, 3 times in 28, null |
| Edit | `toolUseResult: { filePath, oldString, newString, replaceAll, originalFile, structuredPatch }`; `originalFile` was null in 81 of 223 Edits. Of those, 67 followed a Write or a complete Read of the file in the same transcript; 14 did not, and cannot be rebuilt. `contentNotInModelContext: true` and `staleRecovered` sometimes appear |

Paths in `toolUseResult` are absolute. No record says what a Bash command changed.
