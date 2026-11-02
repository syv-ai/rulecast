import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { sessionDir } from "../../src/core/session/session"
import type { Event } from "../../src/core/types"
import { createFixture } from "../helpers/fixture"
import { stateDirFor } from "../helpers/home"
import { pipelineAt } from "../helpers/pipeline"

const USERS = "app/services/users.py"
const SESSION = "corrupt"

/**
 * Spec §14: a session store with an unparseable line mid-file. It used to throw out of the hook,
 * then (until plan 21) dropped session memory, and with it the stop check, for every later hook of
 * the session, since nothing repaired the store. A line can be lost when two writers interleave
 * (an append that could not get the lock in time) or after a crash; the line is skipped, and the
 * rest of the session's records still count.
 */
async function corrupt(root: string, file: string): Promise<void> {
  const store = path.join(sessionDir(stateDirFor(root), SESSION), file)
  const text = await readFile(store, "utf8")
  await writeFile(store, `${text.trimEnd()}\n{"t":"edited","fi\n{"t":"prompt","agent":"main"}\n`)
}

const send = (root: string, event: Omit<Event, "cwd" | "session">) =>
  pipelineAt(root, { ...event, cwd: root, session: { id: SESSION } }, { stopGate: true })

describe("pipeline with a damaged session store", () => {
  test("a half-written record mid-file is skipped: the session keeps its memory and its stop check", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, USERS), "def get():\n    raise HTTPException(418)\n")
    await send(root, { kind: "edit", files: [USERS] })
    await corrupt(root, "work.jsonl")

    const edit = await send(root, { kind: "edit", files: [USERS] })
    expect(edit.delivery.warnings).toEqual([])
    expect(edit.delivery.findings.map((finding) => finding.rule)).toEqual(["backend/no-httpexception"])

    // The stop still knows what the agent edited, and holds it there.
    const stop = await send(root, { kind: "verify", files: [] })
    expect(stop.delivery.stop).toBe("block")
    expect(stop.delivery.findings.map((finding) => finding.rule)).toEqual(["backend/no-httpexception"])
  })

  test("a damaged baseline is read the same way", async () => {
    const root = await createFixture()
    await send(root, { kind: "touch", files: [USERS], completeRead: true })
    await corrupt(root, "baseline.jsonl")

    const { delivery } = await send(root, { kind: "edit", files: [USERS] })
    expect(delivery.warnings).toEqual([])
  })
})
