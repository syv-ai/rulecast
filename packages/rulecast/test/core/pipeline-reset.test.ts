import { describe, expect, test } from "vitest"

import type { Delivery, EventKind } from "../../src/core/types"
import { emptyDelivery } from "../../src/core/types"
import { createFixture } from "../helpers/fixture"
import { pipelineAt } from "../helpers/pipeline"

const USERS = "app/services/users.py"
const SERVICES = {
  ref: "conventions/backend.md#services",
  state: "full",
  content: "## Services\nBusiness logic lives in services.",
}

async function scenario(restoredFiles = 5) {
  const root = await createFixture()
  const send = async (kind: EventKind, files: string[] = [], agentId?: string): Promise<Delivery> => {
    const session = agentId === undefined ? { id: "s1" } : { id: "s1", agentId }
    const extra = kind === "touch" ? { completeRead: true } : {}
    const result = await pipelineAt(root, { kind, files, cwd: root, session, ...extra }, { restoredFiles })
    return result.delivery
  }
  return { root, send }
}

describe("reset re-delivers touch context", () => {
  test("for files the agent read before compaction", async () => {
    const { send } = await scenario()
    expect((await send("touch", [USERS])).touches).toEqual(["backend/services"])
    const reset = await send("reset")
    expect(reset.touches).toEqual(["backend/services"])
    expect(reset.references).toEqual([SERVICES])
    // Delivered again, so recorded again: the next touch finds it covered.
    expect((await send("touch", [USERS])).touches).toEqual([])
  })

  test("for files the agent edited", async () => {
    const { send } = await scenario()
    await send("edit", [USERS])
    expect((await send("reset")).touches).toEqual(["backend/services"])
  })

  test("only for the most recent restoredFiles files", async () => {
    const { send } = await scenario(5)
    await send("touch", [USERS])
    for (let i = 1; i <= 5; i++) await send("touch", [`docs/note-${i}.md`])
    const reset = await send("reset")
    expect(reset.touches).toEqual([])
    expect(reset.references).toEqual([])
  })

  test("not for files a subagent accessed", async () => {
    const { send } = await scenario()
    await send("touch", [USERS], "sub1")
    expect(await send("reset")).toEqual(emptyDelivery())
    // The subagent's own reset restores its own files.
    expect((await send("reset", [], "sub1")).touches).toEqual(["backend/services"])
  })

  test("never when the adapter restores no files", async () => {
    const { send } = await scenario(0)
    await send("touch", [USERS])
    expect(await send("reset")).toEqual(emptyDelivery())
    // Context memory was still cleared.
    expect((await send("touch", [USERS])).touches).toEqual(["backend/services"])
  })
})
