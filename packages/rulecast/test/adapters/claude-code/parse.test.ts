import { describe, expect, test } from "vitest"

import { parseClaudeCode } from "../../../src/adapters/claude-code/parse"
import type { EventKind } from "../../../src/core/types"
import { claudeCodePayload } from "../../helpers/payloads"

const parse = (name: string) => {
  const payload = claudeCodePayload(name)
  return { payload, parsed: parseClaudeCode(payload) }
}

describe("Claude Code adapter: parse", () => {
  test.each<[string, EventKind, string[], boolean | undefined]>([
    ["post-tool-use.read.complete", "touch", ["/project/src/math.ts"], true],
    ["post-tool-use.read.partial", "touch", ["/project/src/math.ts"], false],
    ["post-tool-use.read.relative-response-path", "touch", ["/project/src/wide.txt"], true],
    ["post-tool-use.edit", "edit", ["/project/src/math.ts"], undefined],
    ["post-tool-use.edit.replace-all", "edit", ["/project/src/new.ts"], undefined],
    ["post-tool-use.write.create", "edit", ["/project/src/new.ts"], undefined],
    ["post-tool-use.write.update", "edit", ["/project/src/wide.txt"], undefined],
    ["stop", "verify", [], undefined],
    ["stop.after-block", "verify", [], undefined],
    ["user-prompt-submit", "prompt", [], undefined],
    ["session-start.compact", "reset", [], undefined],
  ])("%s → %s", (name, kind, files, completeRead) => {
    const { payload, parsed } = parse(name)
    expect(parsed).toEqual({
      cwd: "/project",
      warmup: false,
      event: { kind, files, completeRead, cwd: "/project", session: { id: payload.session_id } },
    })
  })

  test("pre-tool-use.edit → guard carrying the replacement the tool will make", () => {
    const { payload, parsed } = parse("pre-tool-use.edit")
    expect(parsed).toEqual({
      cwd: "/project",
      warmup: false,
      event: {
        kind: "guard",
        files: ["/project/src/math.ts"],
        cwd: "/project",
        session: { id: payload.session_id },
        intent: {
          edit: {
            find: "export function sub(a: number, b: number) {",
            replace: "export function subtract(a: number, b: number) {",
            all: false,
          },
        },
      },
    })
  })

  test("pre-tool-use.write → guard carrying the whole file", () => {
    const { parsed } = parse("pre-tool-use.write")
    expect(parsed?.event?.kind).toBe("guard")
    expect(parsed?.event?.intent).toEqual({ content: "export const added = 1\n" })
  })

  test("a PreToolUse for a tool that is neither a write nor the shell has no event", () => {
    const payload = { ...claudeCodePayload("pre-tool-use.edit"), tool_name: "Grep" }
    expect(parseClaudeCode(payload)?.event).toBeNull()
  })

  test.each<[string, EventKind]>([
    ["pre-tool-use.bash", "shell-before"],
    ["post-tool-use.bash", "shell-after"],
    // Fires at launch; the job's writes are swept later.
    ["post-tool-use.bash.background", "shell-after"],
  ])("%s → %s, carrying the tool use id and no files", (name, kind) => {
    const { payload, parsed } = parse(name)
    expect(parsed).toEqual({
      cwd: "/project",
      warmup: false,
      event: { kind, files: [], cwd: "/project", session: { id: payload.session_id }, toolUseId: payload.tool_use_id },
    })
  })

  test("post-tool-use-failure.bash → shell-after, marked failed", () => {
    // A command that exits non-zero fires only the Failure hook, and may have written files first.
    const { payload, parsed } = parse("post-tool-use-failure.bash")
    expect(parsed?.event).toEqual({
      kind: "shell-after",
      files: [],
      cwd: "/project",
      session: { id: payload.session_id },
      toolUseId: payload.tool_use_id,
      failed: true,
    })
  })

  test("Pre and Post of one Bash call carry the same tool use id", () => {
    expect(parse("pre-tool-use.bash").parsed?.event?.toolUseId).toBe(
      parse("post-tool-use.bash").parsed?.event?.toolUseId,
    )
  })

  test("post-tool-use.bash.subagent carries the subagent's agent id", () => {
    const { payload, parsed } = parse("post-tool-use.bash.subagent")
    expect(parsed?.event?.kind).toBe("shell-after")
    expect(parsed?.event?.session).toEqual({ id: payload.session_id, agentId: payload.agent_id })
  })

  test("a Bash payload without a tool use id still maps, without one", () => {
    const { tool_use_id: _, ...payload } = claudeCodePayload("post-tool-use.bash")
    const event = parseClaudeCode(payload)?.event
    expect(event?.kind).toBe("shell-after")
    expect(event && "toolUseId" in event).toBe(false)
  })

  test("a write whose shape rulecast does not recognise has no event, so it cannot be refused", () => {
    const payload = claudeCodePayload("pre-tool-use.edit")
    payload.tool_input = { file_path: "/project/src/math.ts" }
    expect(parseClaudeCode(payload)?.event).toBeNull()
  })

  test.each<[string, EventKind]>([
    ["post-tool-use.read.subagent", "touch"],
    ["post-tool-use.edit.subagent", "edit"],
    ["subagent-stop", "verify"],
    ["subagent-stop.after-block", "verify"],
  ])("%s carries the subagent's agent id", (name, kind) => {
    const { payload, parsed } = parse(name)
    expect(parsed?.event?.kind).toBe(kind)
    expect(parsed?.event?.session).toEqual({ id: payload.session_id, agentId: payload.agent_id })
  })

  test.each([
    "post-tool-use.agent",
    "post-tool-use-failure.read.too-large",
    "subagent-stop.compaction",
    "pre-compact.manual",
    "user-prompt-submit.task-notification",
  ])("%s has no event", (name) => {
    expect(parse(name).parsed).toEqual({ cwd: "/project", event: null, warmup: false })
  })

  test.each(["session-start.clear", "session-start.fork"])(
    "%s → start, without warm-up: a new session id, whose dirty files need their snapshots",
    (name) => {
      const { payload, parsed } = parse(name)
      expect(parsed).toEqual({
        cwd: "/project",
        event: { kind: "start", files: [], cwd: "/project", session: { id: payload.session_id } },
        warmup: false,
      })
    },
  )

  test.each(["session-start.startup", "session-start.startup.interactive", "session-start.resume"])(
    "%s → start, and starts warm-up",
    (name) => {
      const { payload, parsed } = parse(name)
      expect(parsed).toEqual({
        cwd: "/project",
        event: { kind: "start", files: [], cwd: "/project", session: { id: payload.session_id } },
        warmup: true,
      })
    },
  )

  test.each([
    null,
    "text",
    {},
    { hook_event_name: "Stop", cwd: "/project" },
    { hook_event_name: "Stop", session_id: "", cwd: "/project" },
  ])("rejects malformed input %j", (input) => {
    expect(parseClaudeCode(input)).toBeNull()
  })
})
