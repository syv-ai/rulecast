import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runPipeline } from "../../src/core/pipeline"
import type { Event } from "../../src/core/types"
import { createFixture, registry } from "../helpers/fixture"

const USERS = "app/services/users.py"

async function scenario() {
  const root = await createFixture()
  const send = async (event: Omit<Event, "cwd" | "session"> & { agentId?: string }) => {
    const { agentId, ...rest } = event
    const result = await runPipeline({
      root,
      event: { ...rest, cwd: root, session: { id: "s1", agentId } },
      registry,
      maxContextChars: null,
    })
    return result.delivery
  }
  const write = (content: string) => writeFile(path.join(root, USERS), content)
  return { root, send, write }
}

const refStates = (delivery: { references: { ref: string; state: string }[] }) =>
  delivery.references.map((reference) => `${reference.ref}:${reference.state}`)

describe("pipeline with a session", () => {
  test("touch delivers touch conventions once per context", async () => {
    const { send } = await scenario()
    const first = await send({ kind: "touch", files: [USERS], completeRead: true })
    expect(first.touches).toEqual(["backend/services"])
    expect(first.references).toEqual([
      {
        ref: "conventions/backend.md#services",
        state: "full",
        content: "## Services\nBusiness logic lives in services.",
      },
    ])
    const second = await send({ kind: "touch", files: [USERS], completeRead: true })
    expect(second.touches).toEqual([])
    expect(second.references).toEqual([])
  })

  test("edit reports new findings, summarises pre-existing ones and dedupes references", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [USERS], completeRead: true })
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")

    const first = await send({ kind: "edit", files: [USERS] })
    expect(first.findings.map((finding) => [finding.line, finding.message])).toEqual([
      [3, "app/services/users.py:3 raises HTTPException(500). Raise a domain exception."],
    ])
    expect(first.preexistingSummary).toEqual([{ rule: "backend/no-httpexception", file: USERS, count: 1 }])
    expect(refStates(first)).toEqual(["conventions/backend.md#errors:full"])

    const second = await send({ kind: "edit", files: [USERS] })
    expect(second.findings).toHaveLength(1)
    expect(second.preexistingSummary).toEqual([])
    expect(refStates(second)).toEqual(["conventions/backend.md#errors:pointer"])
  })

  test("stop gate blocks up to the cap per prompt and allows once fixed", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [USERS], completeRead: true })
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    await send({ kind: "edit", files: [USERS] })

    const stops = []
    for (let i = 0; i < 4; i++) stops.push((await send({ kind: "verify", files: [] })).stop)
    expect(stops).toEqual(["block", "block", "block", "capReached"])

    await send({ kind: "prompt", files: [] })
    expect((await send({ kind: "verify", files: [] })).stop).toBe("block")

    await write("def get():\n    raise HTTPException(404)\n    raise NotFound()\n")
    const fixed = await send({ kind: "verify", files: [] })
    expect(fixed.stop).toBe("allow")
    expect(fixed.findings).toEqual([])
  })

  test("reset clears delivered references; subagents have their own context", async () => {
    const { send, write } = await scenario()
    await send({ kind: "touch", files: [USERS], completeRead: true })
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    await send({ kind: "edit", files: [USERS] })
    expect(refStates(await send({ kind: "edit", files: [USERS] }))).toEqual(["conventions/backend.md#errors:pointer"])

    // A subagent has seen nothing: the touch convention and the errors section both arrive in full.
    expect(refStates(await send({ kind: "edit", files: [USERS], agentId: "sub1" }))).toEqual([
      "conventions/backend.md#errors:full",
      "conventions/backend.md#services:full",
    ])

    await send({ kind: "reset", files: [] })
    expect(refStates(await send({ kind: "edit", files: [USERS] }))).toEqual([
      "conventions/backend.md#errors:full",
      "conventions/backend.md#services:full",
    ])
  })

  test("edits of files never read fall back to the session-start commit", async () => {
    const { send, write } = await scenario()
    await write("def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    const delivery = await send({ kind: "edit", files: [USERS] })
    expect(delivery.findings.map((finding) => finding.line)).toEqual([3])
    expect(delivery.touches).toEqual(["backend/services"])
  })
})
