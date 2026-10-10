# Claude Code hook payloads

Recorded 2026-09-16 from Claude Code 2.1.273 (`claude -p` and one interactive session driven by `expect`), with every hook event piped to a recorder. Paths are rewritten: the project is `/project`, the Claude config directory is `/home/user/.claude`, and a 6,000-char line in the `write.update` fixture is shortened to 20 chars. Everything else is as recorded.

## Files

| File | Event | Notes |
|---|---|---|
| `session-start.startup.json` | `SessionStart` | `-p` run |
| `session-start.startup.interactive.json` | `SessionStart` | interactive run: also carries `scratchpad_dir`, `model` |
| `session-start.resume.json` | `SessionStart` | `--resume`: same `session_id` as the resumed session |
| `session-start.compact.json` | `SessionStart` | after `/compact`: same `session_id` |
| `session-start.clear.json` | `SessionStart` | after `/clear`: **new** `session_id` |
| `session-start.fork.json` | `SessionStart` | `--resume --fork-session`: new `session_id` |
| `pre-compact.manual.json` | `PreCompact` | |
| `user-prompt-submit.json` | `UserPromptSubmit` | |
| `user-prompt-submit.task-notification.json` | `UserPromptSubmit` | a background subagent finished (interactive session); recorded later the same day |
| `post-tool-use.read.complete.json` | `PostToolUse` Read | no offset/limit |
| `post-tool-use.read.partial.json` | `PostToolUse` Read | `offset: 5, limit: 2` |
| `post-tool-use.read.relative-response-path.json` | `PostToolUse` Read | `tool_response.file.filePath` is relative (`src/wide.txt`) |
| `post-tool-use-failure.read.too-large.json` | `PostToolUseFailure` Read | 4.3 MB file; `PostToolUse` does not fire |
| `pre-tool-use.edit.json` | `PreToolUse` Edit | no `tool_response`: the file is unchanged |
| `pre-tool-use.write.json` | `PreToolUse` Write | `tool_input.content` is the whole file |
| `post-tool-use.edit.json` | `PostToolUse` Edit | |
| `post-tool-use.edit.replace-all.json` | `PostToolUse` Edit | `replace_all: true` |
| `post-tool-use.write.create.json` | `PostToolUse` Write | `tool_response.type: "create"` |
| `post-tool-use.write.update.json` | `PostToolUse` Write | `tool_response.type: "update"` |
| `post-tool-use.read.subagent.json` | `PostToolUse` Read | inside a subagent: `agent_id`, `agent_type` |
| `post-tool-use.edit.subagent.json` | `PostToolUse` Edit | inside a subagent |
| `post-tool-use.agent.json` | `PostToolUse` Agent | the parent's view of a finished subagent |
| `stop.json` | `Stop` | |
| `stop.after-block.json` | `Stop` | re-fired after a block: `stop_hook_active: true` |
| `subagent-stop.json` | `SubagentStop` | |
| `subagent-stop.after-block.json` | `SubagentStop` | `stop_hook_active: true` |
| `subagent-stop.compaction.json` | `SubagentStop` | fired by `/compact`'s summariser: `agent_type: ""` |
| `pre-tool-use.bash.json` | `PreToolUse` Bash | `sed -i` edit; recorded 2026-10-10 (see below) |
| `post-tool-use.bash.json` | `PostToolUse` Bash | the same call: same `tool_use_id`, `tool_response` has `stdout`/`stderr` |
| `post-tool-use-failure.bash.json` | `PostToolUseFailure` Bash | `false`: no `tool_response`; `error: "Exit code 1"`, `is_interrupt` |
| `post-tool-use.bash.background.json` | `PostToolUse` Bash | `run_in_background: true`: fires at launch, `tool_response.backgroundTaskId` |
| `post-tool-use.bash.subagent.json` | `PostToolUse` Bash | inside a subagent: `agent_id`, `agent_type` |

## Findings

- **No `MultiEdit` tool.** 2.1.273 offers `Read`, `Edit`, `Write`; the model reported `MultiEdit` unavailable.
- **Paths.** `tool_input.file_path` is absolute. `tool_response.file.filePath` on Read is sometimes relative, so use `tool_input`.
- **Complete read.** No 2,000-line cap: a 2,600-line file came back whole (`startLine: 1`, `numLines: 2601`, `totalLines: 2601`). A read is complete when `startLine === 1 && numLines === totalLines`. A file over 256 KB fails the read (`PostToolUseFailure`) instead of truncating.
- **Subagents.** Subagent events share the parent's `session_id` and add `agent_id` and `agent_type`. Main-agent events have neither.
- **Compaction runs a subagent.** `/compact` fires `PreCompact`, then `SubagentStop` with `agent_type: ""`, then `SessionStart` `compact`. It sends no `UserPromptSubmit` and no `Stop`. A `SubagentStop` block must skip `agent_type: ""`.
- **Background tasks submit prompts.** When a background subagent finishes, Claude Code fires `UserPromptSubmit` with a `prompt` starting `<task-notification>`. No other field tells it apart from a user's prompt. Background is the default for subagents in interactive sessions; `claude -p` ran the same subagent in the foreground.
- **Session ids.** `resume` and `compact` keep the `session_id`; `clear` and `fork` start a new one.
- **Stop block.** `{"decision":"block","reason":"…"}` on stdout, exit 0, works for both `Stop` and `SubagentStop`. The agent sees a user message `Stop hook feedback:\n<reason>` and continues; the next stop has `stop_hook_active: true`. The model complied but called the reason "instruction injection via tooling", so the reason should say it comes from the project's rulecast conventions.
- **`PreToolUse` denies.** `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` on stdout, exit 0, refuses the tool call; the reason reaches the model in place of the tool's result. `PostToolUse` cannot block — it fires after the call succeeded — so refusing a write is only possible here. Recorded 2026-09-23 with the Edit and Write payloads above.
- **`additionalContext` limit: 10,000 chars.** `hookSpecificOutput.additionalContext` of up to 10,000 chars (JS string length; 9,990 two-byte chars still inline) is injected whole. At 10,001 chars it is replaced by a `<persisted-output>` block: "Output too large (9.8KB). Full output saved to: <path>" plus a 2 KB preview. Nothing is truncated in between, so `maxContextChars` is 10,000.
- **Non-interactive runs.** `claude -p` waits 3 s for stdin unless it is redirected (`< /dev/null`).
- **Compaction re-attaches files.** Recorded on 2026-09-19 with Claude Code 2.1.278 (`claude -p --resume <session-id> "/compact" < /dev/null` compacts without an interactive session; hooks fire `SessionStart` resume, `PreCompact`, `SubagentStop`, `SessionStart` compact). After `/compact`, the main agent's 5 most recently read, edited or written files come back as `attachment` entries of type `file`, newest first, with no Read call. A partial read comes back whole; an edited file with its current content; a very large file (38,000 chars in the recording) becomes a pointer telling the agent to Read it, while an 11,400-char file came back whole. A second `/compact` with no reads in between re-attached nothing.
- **`SessionStart` `compact` output.** `hookSpecificOutput.additionalContext` reaches the model as a system reminder ("SessionStart hook additional context: …"); plain stdout is injected too. 12,040 chars were replaced by a `<persisted-output>` pointer with a 2 KB preview, as for `PostToolUse`. The recorded `SessionStart` compact payload has the same keys as `session-start.compact.json`.
- **`systemMessage` reaches the user on every event rulecast uses.** Checked against the hooks reference (code.claude.com/docs/en/hooks) on 2026-10-09: `systemMessage` is a common output field, "Warning message shown to the user", accepted by every event; the events that discard it are listed per event (Setup, InstructionsLoaded, Notification, ConfigChange, PreCompact, PostCompact, SessionEnd, WorktreeRemove, Elicitation, ElicitationResult), and `Stop`, `SubagentStop`, `PostToolUse` and `SessionStart` are not among them. `Stop` and `SubagentStop` take it beside `decision: "block"` ("in addition to the JSON output fields available to all hooks"). An async hook's `systemMessage` goes to the model instead; rulecast's hooks are synchronous. Plan 10 relies on this for user notices (config changed, ignores added) and for rule warnings.
- **A non-zero exit other than 2** is a non-blocking error: the action goes ahead and the transcript shows a `<hook name> hook error` notice with the first line of stderr. This is what a committed hook command shows on every event in a clone without `node_modules` — the reason plan 10's hook command exits 0 when the binary is missing.
- **Bash payloads.** Recorded 2026-10-10 from Claude Code 2.1.296 (`claude -p`, logging hook on `PreToolUse`, `PostToolUse` and `PostToolUseFailure` with matcher `Bash`). A command that exits non-zero fires `PostToolUseFailure` only, never `PostToolUse`; it carries `error` and `is_interrupt` and no `tool_response`, so a command that edits a file and then fails is seen only there. Every Bash payload carries `tool_use_id`, the same on `PreToolUse` and on its `PostToolUse`/`PostToolUseFailure`. A `run_in_background` call's `PostToolUse` fires as soon as the job is launched (5 ms in the recording, the job ran 3 s), with empty `stdout` and `tool_response.backgroundTaskId`; no hook event fires when the job finishes, so its writes are only seen by a later tree comparison. A subagent's Bash payloads carry `agent_id` and `agent_type`, as its Edit payloads do. `tool_input` has `command`, `description` and, when set, `run_in_background`; no file path.
