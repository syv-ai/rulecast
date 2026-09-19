import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { claudeCodePayload } from "../helpers/payloads"

const USERS = "app/services/users.py"

function hook(root: string, name: string, file?: string) {
  const payload = claudeCodePayload(name, { root, file, sessionId: "s1" })
  return runCli(root, ["hook", "claude-code"], JSON.stringify(payload))
}

describe("rulecast hook claude-code: compaction", () => {
  test("SessionStart compact re-delivers the touch conventions of a file read before it", async () => {
    const root = await createFixture()
    await hook(root, "post-tool-use.read.complete", USERS)
    const compact = await hook(root, "session-start.compact")
    expect(compact.code).toBe(0)
    const output = JSON.parse(compact.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart")
    expect(output.hookSpecificOutput.additionalContext).toContain(
      "--- conventions/backend.md#services ---\n## Services\nBusiness logic lives in services.",
    )
  })

  test("a file the agent edited is restored too", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, USERS), "def get():\n    return None\n")
    await hook(root, "post-tool-use.edit", USERS)
    const output = JSON.parse((await hook(root, "session-start.compact")).stdout)
    expect(output.hookSpecificOutput.additionalContext).toContain("--- conventions/backend.md#services ---")
  })

  test("nothing accessed, or accessed only by a subagent: compaction prints nothing", async () => {
    const root = await createFixture()
    expect(await hook(root, "session-start.compact")).toMatchObject({ code: 0, stdout: "" })
    await hook(root, "post-tool-use.read.subagent", USERS)
    expect(await hook(root, "session-start.compact")).toMatchObject({ code: 0, stdout: "" })
  })
})
