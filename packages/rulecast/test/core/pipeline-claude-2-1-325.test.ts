import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import type { DistributiveOmit, Event } from "../../src/core/types"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureFiles, fixtureRules } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

/** What Claude Code 2.1.325 adds to a stop: a subagent's hand-back, and work still running. */

const USERS = "app/services/users.py"
const ORDERS = "app/services/orders.py"
const violation = (file: string) => `${fixtureFiles[file] ?? "def get():\n"}    raise HTTPException(500)\n`

async function scenario(env?: Record<string, string>) {
  const root = await createFixture()
  const send = async (event: DistributiveOmit<Event, "cwd" | "session"> & { agentId?: string }) => {
    const { agentId, ...rest } = event
    const options = { stopGate: true, ...(env === undefined ? {} : { env }) }
    return (await pipelineAt(root, { ...rest, cwd: root, session: { id: "s1", agentId } } as Event, options)).delivery
  }
  const edit = async (file: string, content: string, agentId?: string) => {
    await writeFile(path.join(root, file), content)
    return send({ kind: "edit", files: [file], agentId })
  }
  return { root, send, edit }
}

describe("a subagent's hand-back is its stop, refused fewer times than Claude Code retries it", () => {
  test("attended: refused once, then let through with the findings for the user", async () => {
    const { send, edit } = await scenario()
    await send({ kind: "start", files: [] })
    await edit(USERS, violation(USERS), "sub1")
    const handback = { kind: "verify" as const, files: [], agentId: "sub1", handback: true }
    expect((await send(handback)).stop).toBe("block")
    expect((await send(handback)).stop).toBe("capReached")
  })

  test("unattended, whatever unattended.max_blocks says: one block and the report, then let through", async () => {
    // Four refusals in a row lost the subagent's report on 2.1.325 (test/payloads/claude-code/README.md).
    const { send, edit } = await scenario({ RULECAST_MODE: "unattended" })
    await send({ kind: "start", files: [] })
    await edit(USERS, violation(USERS), "sub1")
    const handback = { kind: "verify" as const, files: [], agentId: "sub1", handback: true }
    expect((await send(handback)).stop).toBe("block")
    expect((await send(handback)).stop).toBe("report")
    expect((await send(handback)).stop).toBe("capReached")
  })
})

describe("a stop while work the agent started still runs", () => {
  test("the main stop leaves a running subagent's files to it; once it finished, they count", async () => {
    const { send, edit } = await scenario()
    await send({ kind: "start", files: [] })
    await edit(ORDERS, violation(ORDERS), "sub1")
    const running = await send({ kind: "verify", files: [], running: { agents: ["sub1"], shells: 0 } })
    expect(running.stop).toBe("allow")
    expect(running.findings).toEqual([])
    const finished = await send({ kind: "verify", files: [] })
    expect(finished.stop).toBe("block")
    expect(finished.findings.map((finding) => finding.file)).toEqual([ORDERS])
  })

  test("the main agent's own files still count while a subagent runs", async () => {
    const { send, edit } = await scenario()
    await send({ kind: "start", files: [] })
    await edit(USERS, violation(USERS))
    await edit(ORDERS, violation(ORDERS), "sub1")
    const stop = await send({ kind: "verify", files: [], running: { agents: ["sub1"], shells: 0 } })
    expect(stop.stop).toBe("block")
    expect(stop.findings.map((finding) => finding.file)).toEqual([USERS])
  })

  test("a running shell job never defers the sweep: a dev server may run all session", async () => {
    const { root, send } = await scenario()
    await send({ kind: "start", files: [] })
    await send({ kind: "shell-before", files: [], toolUseId: "t1" })
    await send({ kind: "shell-after", files: [], toolUseId: "t1" })
    await writeFile(path.join(root, USERS), violation(USERS))
    const stop = await send({ kind: "verify", files: [], running: { agents: [], shells: 1 } })
    expect(stop.swept).toEqual([USERS])
  })

  test("a running subagent defers the sweep, and the stop says so in one line; the next stop sweeps", async () => {
    const { root, send } = await scenario()
    await send({ kind: "start", files: [] })
    await send({ kind: "shell-before", files: [], toolUseId: "t1" })
    await send({ kind: "shell-after", files: [], toolUseId: "t1" })
    await writeFile(path.join(root, USERS), violation(USERS))
    const running = await send({ kind: "verify", files: [], running: { agents: ["sub1"], shells: 0 } })
    expect(running.swept).toBeUndefined()
    expect(running.notices).toEqual([
      "rulecast: a subagent is still running, so files changed outside the agents' tool calls are checked at a later stop.",
    ])
    const after = await send({ kind: "verify", files: [] })
    expect(after.swept).toEqual([USERS])
  })
})

describe("a subagent's start: the project's convention docs, as paths", () => {
  test("the conventions file and the docs local rules cite, each once, shown from the agent's cwd", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig(fixtureRules, { conventions: "docs/conventions.md" }),
      "docs/conventions.md": "# Conventions\n",
      "conventions/backend.md": "# Backend\n## Errors\n## Services\n",
    })
    const event: Event = { kind: "agent-start", files: [], cwd: root, session: { id: "s1", agentId: "sub1" } }
    const result = await pipelineAt(root, event, { displayFrom: path.join(root, "app") })
    expect(result.delivery.conventionDocs).toEqual(["../docs/conventions.md", "../conventions/backend.md"])
  })

  test("subagent_docs: false hands nothing", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig(fixtureRules, { subagent_docs: false }),
      "conventions/backend.md": "# Backend\n",
    })
    const event: Event = { kind: "agent-start", files: [], cwd: root, session: { id: "s1", agentId: "sub1" } }
    expect((await pipelineAt(root, event)).delivery.conventionDocs).toBeUndefined()
  })
})
