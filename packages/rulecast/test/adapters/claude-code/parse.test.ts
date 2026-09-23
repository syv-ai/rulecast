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

  test("a PreToolUse for a tool that is not a write has no event", () => {
    const payload = { ...claudeCodePayload("pre-tool-use.edit"), tool_name: "Bash" }
    expect(parseClaudeCode(payload)?.event).toBeNull()
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
    "session-start.clear",
    "session-start.fork",
  ])("%s has no event", (name) => {
    expect(parse(name).parsed).toEqual({ cwd: "/project", event: null, warmup: false })
  })

  test.each(["session-start.startup", "session-start.startup.interactive", "session-start.resume"])(
    "%s starts warm-up",
    (name) => {
      expect(parse(name).parsed).toEqual({ cwd: "/project", event: null, warmup: true })
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
