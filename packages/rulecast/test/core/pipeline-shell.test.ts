import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { readBaseline } from "../../src/core/baseline/store"
import { renderAgentText } from "../../src/core/delivery/render-agent"
import { openSession, sessionDir } from "../../src/core/session/session"
import { type Event, emptyDelivery } from "../../src/core/types"
import { localConfig } from "../helpers/config"
import { createFixture, fixtureFiles, fixtureRules } from "../helpers/fixture"
import { createRepo, git } from "../helpers/git"
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
  let calls = 0
  /** One shell call: its before hook, what the command does, its after hook. */
  const shell = async (act: () => Promise<unknown>, options: { agentId?: string; id?: string | null } = {}) => {
    const toolUseId = options.id === null ? undefined : (options.id ?? `toolu_${++calls}`)
    await send({ kind: "shell-before", files: [], toolUseId, agentId: options.agentId })
    await act()
    return send({ kind: "shell-after", files: [], toolUseId, agentId: options.agentId })
  }
  return {
    send,
    shell,
    write: (file: string, content: string) => writeFile(path.join(root, file), content),
    baseline: () => readBaseline(dir),
    work: async () => (await openSession(dir, "main")).work,
  }
}

const lines = (delivery: { findings: { file: string; line: number }[] }) =>
  delivery.findings.map((finding) => `${finding.file}:${finding.line}`)

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

describe("a shell call's changes go through the edit event", () => {
  test("an in-place rewrite of a clean file (sed -i): the finding is new, and the agent's", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    const delivery = await session.shell(() =>
      session.write(USERS, `${fixtureFiles[USERS]}    raise HTTPException(500)\n`),
    )
    expect(lines(delivery)).toEqual([`${USERS}:3`])
    expect(delivery.via).toBe("shell")
    const work = await session.work()
    expect(work.edited).toEqual([USERS])
    expect(work.editedVia.get(USERS)).toBe("shell")
    // Stop verifies it like any edited file.
    expect((await session.send({ kind: "verify", files: [] })).stop).toBe("block")
  })

  test("a rewrite of a file dirty at start (a Python script): only the agent's lines are new", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    const users = "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n"
    await session.write(USERS, users)
    await session.send({ kind: "start", files: [] })
    // Never read through the edit tools: the start snapshot is the only baseline it has.
    const delivery = await session.shell(() => session.write(USERS, `${users}    raise HTTPException(503)\n`))
    expect(lines(delivery)).toEqual([`${USERS}:4`])
  })

  test("a > redirect creating a file", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    const file = "app/services/orders.py"
    const delivery = await session.shell(() => session.write(file, "def get():\n    raise HTTPException(400)\n"))
    expect(lines(delivery)).toEqual([`${file}:2`])
  })

  test("a deleted file: no detector run, no crash, not recorded as edited", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    const delivery = await session.shell(() => rm(path.join(root, USERS)))
    expect(delivery.findings).toEqual([])
    expect((await session.work()).edited).toEqual([])
  })

  test("checking out another branch is a git operation, not an edit", async () => {
    const root = await createFixture()
    await git(root, "checkout", "-q", "-b", "other")
    await writeFile(path.join(root, USERS), `${fixtureFiles[USERS]}    raise HTTPException(500)\n`)
    await git(root, "commit", "-q", "-am", "other")
    await git(root, "checkout", "-q", "main")
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    const delivery = await session.shell(() => git(root, "checkout", "-q", "other"))
    expect(delivery.findings).toEqual([])
    expect((await session.work()).edited).toEqual([])
  })

  test("git stash && git stash pop restores the same content: not an edit, though every mtime moved", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    // The user's uncommitted violation, there before the session.
    await session.write(USERS, `${fixtureFiles[USERS]}    raise HTTPException(500)\n`)
    await session.send({ kind: "start", files: [] })
    const delivery = await session.shell(async () => {
      await git(root, "stash", "-q")
      await git(root, "stash", "pop", "-q")
    })
    expect(delivery.findings).toEqual([])
    expect((await session.work()).edited).toEqual([])
    expect((await session.send({ kind: "verify", files: [] })).stop).toBe("allow")
  })

  test("a commit during the call is a git operation, not an edit", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    const delivery = await session.shell(async () => {
      await session.write(USERS, `${fixtureFiles[USERS]}    raise HTTPException(500)\n`)
      await git(root, "commit", "-q", "-am", "agent")
    })
    expect(delivery.findings).toEqual([])
    expect((await session.work()).edited).toEqual([])
  })

  test("a codemod across 40 files: every file is the agent's, and Stop verifies them all", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    const files = Array.from({ length: 40 }, (_, index) => `app/services/mod${String(index).padStart(2, "0")}.py`)
    const delivery = await session.shell(() =>
      Promise.all(files.map((file) => session.write(file, "def f():\n    raise HTTPException(500)\n"))),
    )
    // Whatever the edit deadline let finish is delivered now; the rest is the Stop's to verify.
    expect(delivery.findings.length).toBeGreaterThan(0)
    expect((await session.work()).edited).toEqual(files)
    const stop = await session.send({ kind: "verify", files: [] })
    expect(stop.stop).toBe("block")
    expect(new Set(stop.findings.map((finding) => finding.file)).size).toBe(40)
  })

  test("a call that changes no file a rule matches has no output", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    const delivery = await session.shell(async () => {
      await mkdir(path.join(root, "docs"), { recursive: true })
      await session.write("docs/notes.md", "raise HTTPException(500)\n")
    })
    expect(delivery).toEqual(emptyDelivery())
    expect((await session.work()).edited).toEqual([])
  })

  test("an after hook with nothing to compare with: no output, and its state is recorded", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    // A session that began before the Bash hooks were installed: no start, no before.
    await session.write(USERS, `${fixtureFiles[USERS]}    raise HTTPException(500)\n`)
    const delivery = await session.send({ kind: "shell-after", files: [], toolUseId: "toolu_x" })
    expect(delivery.findings).toEqual([])
    expect((await session.work()).latestTree.get("main")?.entries[USERS]).toBeDefined()
  })

  test("a file the user changes between two calls is swept, not folded into the next call", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    await session.shell(async () => {})
    // The user's editor, between calls.
    await session.write(USERS, `${fixtureFiles[USERS]}    raise HTTPException(500)\n`)
    const delivery = await session.shell(() => session.write(API, "export const api = 2\n"))
    expect(delivery.findings.map((finding) => finding.file)).toEqual([API])
    const work = await session.work()
    expect(work.edited).toEqual([API])
    expect(work.swept).toEqual([USERS])
  })

  test("a call without a tool use id compares with the agent's latest state", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    const delivery = await session.shell(
      () => session.write(USERS, `${fixtureFiles[USERS]}    raise HTTPException(500)\n`),
      { id: null },
    )
    expect(lines(delivery)).toEqual([`${USERS}:3`])
  })
})

describe("the Stop sweep", () => {
  const violation = `${fixtureFiles[USERS]}    raise HTTPException(500)\n`

  test("a background job that writes after its call: reported at Stop, Stop allowed", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    // run_in_background: the after hook fires at launch, before the job writes anything.
    await session.shell(async () => {})
    await session.write(USERS, violation)
    const stop = await session.send({ kind: "verify", files: [] })
    expect(stop.stop).toBe("allow")
    expect(lines(stop)).toEqual([`${USERS}:3`])
    expect(stop.swept).toEqual([USERS])
  })

  test("the same write, then a call that changes nothing: swept by that call's before hook", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    await session.shell(async () => {})
    await session.write(USERS, violation)
    const call = await session.shell(async () => {})
    expect(call.findings).toEqual([])
    expect((await session.work()).swept).toEqual([USERS])
    const stop = await session.send({ kind: "verify", files: [] })
    expect(stop.stop).toBe("allow")
    expect(stop.swept).toEqual([USERS])
  })

  test("the user's own edit, with no call after it: reported at Stop, Stop allowed", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    await session.write(USERS, violation)
    const stop = await session.send({ kind: "verify", files: [] })
    expect(stop.stop).toBe("allow")
    expect(stop.swept).toEqual([USERS])
  })

  test("a file the agent changed, changed again between calls, stays the agent's and blocks", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    await session.shell(() => session.write(USERS, violation))
    await session.write(USERS, `${violation}    raise HTTPException(503)\n`)
    await session.shell(async () => {})
    const stop = await session.send({ kind: "verify", files: [] })
    expect(stop.stop).toBe("block")
    expect(stop.swept).toBeUndefined()
    expect((await session.work()).swept).toEqual([])
  })

  test("a subagent's stop sweeps too, and never blocks on it", async () => {
    const root = await createFixture()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    await session.write(USERS, violation)
    const stop = await session.send({ kind: "verify", files: [], agentId: "sub1" })
    expect(stop.stop).toBe("allow")
    expect(stop.swept).toEqual([USERS])
  })

  test("no tree (outside git): Stop verifies the edited files as before", async () => {
    const root = await createProject(fixtureFiles)
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    await session.write(USERS, violation)
    await session.send({ kind: "edit", files: [USERS] })
    const stop = await session.send({ kind: "verify", files: [] })
    expect(stop.stop).toBe("block")
    expect(stop.swept).toBeUndefined()
  })
})

describe("refuse_write under Bash", () => {
  const GENERATED = "frontend/no-generated-edits"
  /** The fixture, with its generated-client rule (a warning) made to refuse writes. */
  const createProtected = () =>
    createRepo({
      ...fixtureFiles,
      ".rulecast-config.yaml": localConfig(
        fixtureRules.map((rule) => (rule.id === GENERATED ? { ...rule, refuse_write: true } : rule)),
      ),
    })

  test("told at once with what to undo, blocks Stop at any severity, and the user hears of it", async () => {
    const root = await createProtected()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    const call = await session.shell(() => session.write(API, "export const api = 2\n"))
    expect(call.refused).toEqual([{ file: API, rule: GENERATED, dirtyAtStart: false }])
    const text = renderAgentText(call, { maxMatchesPerRule: 10 })
    expect(text).toContain(`${API} (${GENERATED}): This file is protected; revert your change.`)
    expect(text).toContain(`git checkout -- ${API}`)
    expect(call.notices).toEqual([`rulecast: the agent changed a protected file with Bash: ${API} (${GENERATED})`])

    const stop = await session.send({ kind: "verify", files: [] })
    expect(stop.stop).toBe("block")
    expect(stop.refused).toEqual(call.refused)
    // Told once: not again at the stop.
    expect(stop.notices ?? []).toEqual([])
  })

  test("reverted with git checkout: the next Stop allows", async () => {
    const root = await createProtected()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    await session.shell(() => session.write(API, "export const api = 2\n"))
    expect((await session.send({ kind: "verify", files: [] })).stop).toBe("block")
    const revert = await session.shell(() => git(root, "checkout", "--", API))
    expect(revert.refused).toBeUndefined()
    const stop = await session.send({ kind: "verify", files: [] })
    expect(stop.stop).toBe("allow")
  })

  test("a protected file dirty at start: undo only the agent's change, not the whole file", async () => {
    const root = await createProtected()
    const session = sessionAt(root)
    await session.write(API, "export const api = 1\nexport const users = 1\n")
    await session.send({ kind: "start", files: [] })
    const call = await session.shell(() =>
      session.write(API, "export const api = 1\nexport const users = 1\nexport const agent = 1\n"),
    )
    expect(call.refused).toEqual([{ file: API, rule: GENERATED, dirtyAtStart: true }])
    const text = renderAgentText(call, { maxMatchesPerRule: 10 })
    expect(text).toContain("It had uncommitted changes before this session: undo only your change, not the whole file.")
    expect(text).not.toContain("git checkout")
  })

  test("the same file changed by Edit takes the existing guard path, unchanged", async () => {
    const root = await createProtected()
    const session = sessionAt(root)
    await session.send({ kind: "start", files: [] })
    const guard = await session.send({
      kind: "guard",
      files: [API],
      intent: { edit: { find: "export const api = 1", replace: "export const api = 2", all: false } },
    })
    expect(guard.findings.map((finding) => finding.rule)).toEqual([GENERATED])
    expect(guard.refused).toBeUndefined()
  })
})
