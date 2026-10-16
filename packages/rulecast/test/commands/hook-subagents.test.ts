import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createFixture } from "../helpers/fixture"
import { claudeCodePayload } from "../helpers/payloads"

const USERS = "app/services/users.py"
const ORDERS = "app/services/orders.py"

function hook(root: string, name: string, overrides: { file?: string; agentId?: string } = {}) {
  const payload = claudeCodePayload(name, { root, sessionId: "s1", ...overrides })
  return runCli(root, ["hook", "claude-code"], JSON.stringify(payload))
}

const stopOf = async (root: string, name: string, agentId?: string) =>
  JSON.parse((await hook(root, name, { agentId })).stdout || "{}") as { decision?: string; reason?: string }

describe("rulecast hook claude-code with two subagents", () => {
  test("each SubagentStop is blocked only for its own file; the main Stop for both", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, USERS), "def get():\n    raise HTTPException(500)\n")
    await writeFile(path.join(root, ORDERS), "def list():\n    raise HTTPException(503)\n")
    await Promise.all([
      hook(root, "post-tool-use.edit.subagent", { file: USERS, agentId: "sub1" }),
      hook(root, "post-tool-use.edit.subagent", { file: ORDERS, agentId: "sub2" }),
    ])

    const first = await stopOf(root, "subagent-stop", "sub1")
    expect(first.decision).toBe("block")
    expect(first.reason).toContain(USERS)
    expect(first.reason).not.toContain(ORDERS)

    const second = await stopOf(root, "subagent-stop.after-block", "sub2")
    expect(second.decision).toBe("block")
    expect(second.reason).toContain(ORDERS)
    expect(second.reason).not.toContain(USERS)

    // A subagent that edited nothing stops.
    expect((await stopOf(root, "subagent-stop", "sub3")).decision).toBeUndefined()

    const main = await stopOf(root, "stop")
    expect(main.decision).toBe("block")
    expect(main.reason).toContain(USERS)
    expect(main.reason).toContain(ORDERS)
  })
})
