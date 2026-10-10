import { z } from "zod"

import type { AdapterInput, EventKind, WriteIntent } from "../../core/types"

const common = z.object({
  hook_event_name: z.string(),
  session_id: z.string().min(1),
  cwd: z.string().min(1),
  agent_id: z.string().min(1).optional(),
  agent_type: z.string().optional(),
  source: z.string().optional(),
  prompt: z.string().optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().min(1).optional(),
})

const fileTool = z.object({
  tool_name: z.string(),
  tool_input: z.object({ file_path: z.string().min(1) }),
})

const readResponse = z.object({
  tool_response: z.object({
    file: z.object({ startLine: z.number(), numLines: z.number(), totalLines: z.number() }),
  }),
})

/** What Write and Edit say they are about to do; anything else shaped differently is left alone. */
const writeInput = z.object({
  tool_input: z.object({
    file_path: z.string().min(1),
    content: z.string().optional(),
    old_string: z.string().optional(),
    new_string: z.string().optional(),
    replace_all: z.boolean().optional(),
  }),
})

/** Maps a Claude Code hook payload (recorded in test/payloads/claude-code) to an adapter input. */
export function parseClaudeCode(input: unknown): AdapterInput | null {
  const head = common.safeParse(input)
  if (!head.success) return null
  const {
    hook_event_name: hook,
    session_id: id,
    cwd,
    agent_id: agentId,
    agent_type: agentType,
    source,
    prompt,
    tool_name: toolName,
    tool_use_id: toolUseId,
  } = head.data
  const session = agentId === undefined ? { id } : { id, agentId }
  const result = (kind: EventKind | null, files: string[] = [], completeRead?: boolean): AdapterInput => ({
    cwd,
    event:
      kind === null ? null : { kind, files, cwd, session, ...(completeRead === undefined ? {} : { completeRead }) },
    warmup: false,
  })
  // Before the file tools: a Bash payload has no file_path, which their schema requires. A command
  // that exits non-zero fires PostToolUseFailure instead of PostToolUse, and may have written files
  // before it failed, so both end the call (test/payloads/claude-code/README.md).
  const shell = (kind: "shell-before" | "shell-after", failed = false): AdapterInput => ({
    cwd,
    event: {
      kind,
      files: [],
      cwd,
      session,
      ...(toolUseId === undefined ? {} : { toolUseId }),
      ...(failed ? { failed } : {}),
    },
    warmup: false,
  })
  if (toolName === "Bash") {
    if (hook === "PreToolUse") return shell("shell-before")
    if (hook === "PostToolUse") return shell("shell-after")
    // Answered under its own hookEventName, so the event says which one fired.
    if (hook === "PostToolUseFailure") return shell("shell-after", true)
  }

  switch (hook) {
    case "PreToolUse": {
      const tool = fileTool.safeParse(input)
      if (!tool.success) return result(null)
      const { tool_name: name } = tool.data
      if (name !== "Edit" && name !== "Write") return result(null)
      const write = writeInput.safeParse(input)
      if (!write.success) return result(null)
      const {
        file_path: file,
        content,
        old_string: find,
        new_string: replace,
        replace_all: all,
      } = write.data.tool_input
      const intent: WriteIntent | null =
        content !== undefined
          ? { content }
          : find !== undefined && replace !== undefined
            ? { edit: { find, replace, all: all === true } }
            : null
      // A shape rulecast does not recognise is not a shape it may refuse.
      if (intent === null) return result(null)
      return { ...result("guard", [file]), event: { kind: "guard", files: [file], cwd, session, intent } }
    }
    case "PostToolUse": {
      const tool = fileTool.safeParse(input)
      if (!tool.success) return result(null)
      const { tool_name: name, tool_input: toolInput } = tool.data
      if (name === "Edit" || name === "Write") return result("edit", [toolInput.file_path])
      if (name !== "Read") return result(null)
      const read = readResponse.safeParse(input)
      const file = read.success ? read.data.tool_response.file : null
      return result(
        "touch",
        [toolInput.file_path],
        file !== null && file.startLine === 1 && file.numLines === file.totalLines,
      )
    }
    case "Stop":
      return result("verify")
    case "SubagentStop":
      // /compact's summariser runs as a subagent with an empty agent type.
      return result(agentType === "" ? null : "verify")
    case "UserPromptSubmit":
      // A background task finishing also submits a prompt; only the user's own prompts reset the stop gate.
      return result(prompt?.startsWith("<task-notification>") ? null : "prompt")
    case "SessionStart":
      if (source === "compact") return result("reset")
      if (source === "startup" || source === "resume") return { ...result("start"), warmup: true }
      // clear and fork arrive with a new session id and empty stores: a session of their own, whose
      // dirty files need their start snapshots like any other. Warm-up already ran at startup.
      if (source === "clear" || source === "fork") return result("start")
      return result(null)
    default:
      return result(null)
  }
}
