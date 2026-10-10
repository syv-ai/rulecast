import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { readBaseline } from "../../src/core/baseline/store"
import { openSession, sessionDir } from "../../src/core/session/session"
import type { Event } from "../../src/core/types"
import { createFixture, fixtureFiles } from "../helpers/fixture"
import { stateDirFor } from "../helpers/home"
import { pipelineAt } from "../helpers/pipeline"
import { createProject } from "../helpers/project"

const USERS = "app/services/users.py"
const API = "src/client/api.ts"

type Send = Omit<Event, "cwd" | "session"> & { agentId?: string }

function sessionAt(root: string, id = "s1") {
  const send = async (event: Send) => {
    const { agentId, ...rest } = event
    return (await pipelineAt(root, { ...rest, cwd: root, session: { id, agentId } }, { stopGate: true })).delivery
  }
  const dir = sessionDir(stateDirFor(root), id)
  return {
    send,
    write: (file: string, content: string) => writeFile(path.join(root, file), content),
    baseline: () => readBaseline(dir),
    work: async () => (await openSession(dir, "main")).work,
  }
}

describe("session start", () => {
  test("records the tree and snapshots the dirty files a rule matches", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    // The user's own uncommitted line, there before the session.
    await session.write(USERS, "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    await session.write("notes.txt", "no rule matches this\n")

    expect((await session.send({ kind: "start", files: [] })).warnings).toEqual([])
    const baseline = await session.baseline()
    expect([...baseline.snapshots.keys()]).toEqual([USERS])
    expect(Object.keys((await session.work()).startTree?.entries ?? {}).sort()).toEqual([USERS, "notes.txt"])

    // The agent adds a line. Only it is new: the user's line is part of the baseline, not the commit.
    await session.write(
      USERS,
      "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n    raise HTTPException(503)\n",
    )
    const edit = await session.send({ kind: "edit", files: [USERS] })
    expect(edit.findings.map((finding) => finding.line)).toEqual([4])
  })

  test("a clean file gets no snapshot: the start commit is its baseline, exactly", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    expect((await session.baseline()).snapshots.size).toBe(0)

    await session.write(USERS, `${fixtureFiles[USERS]}    raise HTTPException(500)\n`)
    const edit = await session.send({ kind: "edit", files: [USERS] })
    expect(edit.findings.map((finding) => finding.line)).toEqual([3])
  })

  test("a resumed session keeps its first snapshot and its first start state", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    const before = "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n"
    await session.write(USERS, before)
    await session.send({ kind: "start", files: [] })

    await session.write(API, "export const api = 2\n")
    await session.write(USERS, `${before}    raise HTTPException(503)\n`)
    await session.send({ kind: "start", files: [] })

    const baseline = await session.baseline()
    expect(baseline.snapshots.get(USERS)).toEqual((await sessionAt(root).baseline()).snapshots.get(USERS))
    const edit = await session.send({ kind: "edit", files: [USERS] })
    expect(edit.findings.map((finding) => finding.line)).toEqual([4])
    // The resume found the client file dirty too; it was not dirty when the session started.
    expect(Object.keys((await session.work()).startTree?.entries ?? {})).toEqual([USERS])
  })

  test("outside git: one warning, and no tree or snapshot records", async () => {
    const root = await createProject(fixtureFiles)
    const session = sessionAt(root)
    const first = await session.send({ kind: "start", files: [] })
    expect(first.warnings).toEqual([
      "rulecast cannot see the working tree here; edits made with Bash are checked only by git hooks and CI",
    ])
    expect((await session.send({ kind: "start", files: [] })).warnings).toEqual([])
    expect((await session.work()).startTree).toBeNull()
    expect((await session.baseline()).snapshots.size).toBe(0)
  })
})
