import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { renderAgentText, repeatedLine } from "../../src/core/delivery/render-agent"
import type { DistributiveOmit, Event } from "../../src/core/types"
import { localConfig } from "../helpers/config"
import { fixtureFiles, fixtureRules } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

// rulecast#90 (decided with both leads, 2026-11-15): a stop says only what is new since the agent's
// last stop, and nothing when nothing is new. Status lines repeated at every stop drown the findings
// and cost the agent turns.

const USERS = "app/services/users.py"
const ORDERS = "app/services/orders.py"
const VIOLATION = `${fixtureFiles[USERS]}    raise HTTPException(500)\n`
const DEFERRED =
  "rulecast: a subagent is still running, so files changed outside the agents' tool calls are checked at a later stop."

async function scenario(rules: Record<string, unknown>[] = fixtureRules) {
  const root = await createRepo({ ...fixtureFiles, ".rulecast-config.yaml": localConfig(rules) })
  const send = async (event: DistributiveOmit<Event, "cwd" | "session"> & { agentId?: string }) => {
    const { agentId, ...rest } = event
    const session = { id: "s1", agentId }
    return (await pipelineAt(root, { ...rest, cwd: root, session } as Event, { stopGate: true })).delivery
  }
  const write = (file: string, content: string) => writeFile(path.join(root, file), content)
  /** A stop in a prompt of its own: attended allows one block per prompt. */
  const stop = async (extra: Partial<Extract<Event, { kind: "verify" }>> = {}) => {
    await send({ kind: "prompt", files: [] })
    return send({ kind: "verify", files: [], ...extra })
  }
  return { root, send, write, stop }
}

const text = (delivery: Parameters<typeof renderAgentText>[0]) => renderAgentText(delivery, { maxMatchesPerRule: 10 })

describe("status lines are said once", () => {
  test("a warning shown at a stop that lets the agent go is not shown again", async () => {
    const broken = { id: "tool/broken", files: "\\.py$", detect: { regex: { pattern: "x" } }, message: "m" }
    const { stop } = await scenario([...fixtureRules, broken])
    const first = await stop()
    expect(first.stop).toBe("allow")
    expect(first.warnings.join("\n")).toContain("tool/broken")
    expect((await stop()).warnings).toEqual([])
  })

  test("the deferred-sweep line: once when deferral starts, again only after a stop that was not deferred", async () => {
    const { send, stop } = await scenario()
    await send({ kind: "start", files: [] })
    const running = { running: { agents: ["sub1"], shells: 0 } }
    expect((await stop(running)).notices).toEqual([DEFERRED])
    expect((await stop(running)).notices ?? []).toEqual([])
    expect((await stop()).notices ?? []).toEqual([])
    expect((await stop(running)).notices).toEqual([DEFERRED])
  })
})

describe("repeats are listed when they change, counted at a block, and fixes are said once", () => {
  test("listed the first time; at the next block a count naming the rules; at a stop let through nothing", async () => {
    const { send, write, stop } = await scenario()
    await write(USERS, VIOLATION)
    await send({ kind: "edit", files: [USERS] })
    expect((await stop()).stop).toBe("block")

    // The first stop that finds it again lists it.
    const listed = await stop()
    expect(listed.stop).toBe("allow")
    expect(listed.repeated).toEqual([{ rule: "backend/no-httpexception", file: USERS }])

    // Unchanged since: let through with nothing to say to the user.
    const quiet = await stop()
    expect(quiet.stop).toBe("allow")
    expect(quiet.repeated).toBeUndefined()
    expect(repeatedLine(quiet, true)).toBeNull()

    // A block for something new: the repeats as a count that names the rules, no list.
    await write(ORDERS, "def get():\n    raise HTTPException(400)\n")
    await send({ kind: "edit", files: [ORDERS] })
    const block = await stop()
    expect(block.stop).toBe("block")
    expect(block.repeated).toBeUndefined()
    expect(text(block)).toContain("1 finding from earlier stops is still there (backend/no-httpexception).")
  })

  test("when earlier findings are fixed, that is said once", async () => {
    const { send, write, stop } = await scenario()
    const sites = (n: number) =>
      `def get():\n${Array.from({ length: n }, (_, i) => `    raise HTTPException(${500 + i})\n`).join("")}`
    await write(USERS, sites(1))
    await write(ORDERS, sites(1))
    await send({ kind: "edit", files: [USERS, ORDERS] })
    expect((await stop()).stop).toBe("block")
    expect((await stop()).repeated).toHaveLength(2)

    await write(ORDERS, "def get():\n    return 1\n")
    await send({ kind: "edit", files: [ORDERS] })
    const fixed = await stop()
    expect(fixed.stop).toBe("allow")
    expect(fixed.repeatedFixed).toEqual({ fixed: 1, of: 2 })
    expect((await stop()).repeatedFixed).toBeUndefined()
  })
})
