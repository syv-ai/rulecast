import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { renderAgentText } from "../../src/core/delivery/render-agent"
import { openSession, sessionDir } from "../../src/core/session/session"
import type { DistributiveOmit, Event } from "../../src/core/types"
import { localConfig } from "../helpers/config"
import { fixtureFiles, fixtureRules } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { stateDirFor } from "../helpers/home"
import { pipelineAt } from "../helpers/pipeline"

const USERS = "app/services/users.py"
const API = "src/client/api.ts"
const VIOLATION = `${fixtureFiles[USERS]}    raise HTTPException(500)\n`
const GENERATED = "frontend/no-generated-edits"

/** The fixture project at `<repo>/backend`, its generated-client rule made to refuse writes. */
async function createNested(): Promise<{ repo: string; root: string }> {
  const files: Record<string, string> = {
    ...fixtureFiles,
    ".rulecast-config.yaml": localConfig(
      fixtureRules.map((rule) => (rule.id === GENERATED ? { ...rule, refuse_write: true } : rule)),
    ),
  }
  const repo = await createRepo(
    Object.fromEntries(Object.entries(files).map(([file, text]) => [`backend/${file}`, text])),
  )
  return { repo, root: path.join(repo, "backend") }
}

type Send = DistributiveOmit<Event, "cwd" | "session">

function sessionAt(root: string, displayFrom: string | undefined, id = "s1", env?: Record<string, string>) {
  let calls = 0
  const send = async (event: Send) =>
    (
      await pipelineAt(
        root,
        { ...event, cwd: root, session: { id } },
        {
          stopGate: true,
          ...(displayFrom === undefined ? {} : { displayFrom }),
          ...(env === undefined ? {} : { env }),
        },
      )
    ).delivery
  return {
    send,
    run: (event: Send) =>
      pipelineAt(
        root,
        { ...event, cwd: root, session: { id } },
        { stopGate: true, ...(displayFrom === undefined ? {} : { displayFrom }) },
      ),
    write: (file: string, content: string) => writeFile(path.join(root, file), content),
    shell: async (act: () => Promise<unknown>) => {
      const toolUseId = `toolu_${++calls}`
      await send({ kind: "shell-before", files: [], toolUseId })
      await act()
      return send({ kind: "shell-after", files: [], toolUseId })
    },
    work: async () => (await openSession(sessionDir(stateDirFor(root), id), "main")).work,
  }
}

describe("paths shown relative to displayFrom", () => {
  test("an edit finding names the file from the repository, its id and records stay root-relative", async () => {
    const { repo, root } = await createNested()
    const shown = sessionAt(root, repo, "shown")
    await shown.write(USERS, VIOLATION)
    const result = await shown.run({ kind: "edit", files: [USERS] })
    const [finding] = result.delivery.findings
    expect(finding?.file).toBe(`backend/${USERS}`)
    expect(finding?.message).toBe(`backend/${USERS}:3 raises HTTPException(500). Raise a domain exception.`)
    // What the pipeline found, and what the session recorded, are the root's.
    expect(new Set(result.findings?.map(({ match }) => match.file))).toEqual(new Set([USERS]))
    expect([...(await shown.work()).edited]).toEqual([USERS])

    const plain = await sessionAt(root, undefined, "plain").run({ kind: "edit", files: [USERS] })
    expect(plain.delivery.findings[0]?.file).toBe(USERS)
    expect(finding?.id).toBe(plain.delivery.findings[0]?.id)
  })

  test("a refused shell write advises reverting the file by its displayed path", async () => {
    const { repo, root } = await createNested()
    const session = sessionAt(root, repo)
    await session.send({ kind: "start", files: [] })
    const call = await session.shell(() => session.write(API, "export const api = 2\n"))
    expect(call.refused).toEqual([{ file: `backend/${API}`, rule: GENERATED, dirtyAtStart: false }])
    const text = renderAgentText(call, { maxMatchesPerRule: 10 })
    expect(text).toContain(`git checkout -- backend/${API}`)
    expect(call.notices).toEqual([
      `rulecast: the agent changed a protected file with Bash: backend/${API} (${GENERATED})`,
    ])
    // The stop still knows the file was the shell's, and blocks on it.
    expect([...(await session.work()).editedVia]).toContainEqual([API, "shell"])
    const stop = await session.send({ kind: "verify", files: [] })
    expect(stop.stop).toBe("block")
    expect(stop.refused).toEqual(call.refused)
  })

  test("a file changed outside the agent's calls is swept under its displayed path, and does not block", async () => {
    const { repo, root } = await createNested()
    const session = sessionAt(root, repo)
    await session.send({ kind: "start", files: [] })
    await session.shell(async () => {})
    await session.write(USERS, VIOLATION)
    const stop = await session.send({ kind: "verify", files: [] })
    expect(stop.stop).toBe("allow")
    expect(stop.swept).toEqual([`backend/${USERS}`])
    expect(stop.findings.map((finding) => finding.file)).toEqual([`backend/${USERS}`])
    expect((await session.work()).swept).toEqual([USERS])
    // The swept findings print under their own heading: the delivery's files and swept agree.
    const text = renderAgentText(stop, { maxMatchesPerRule: 10 })
    expect(text).toContain(`changed outside your tool calls`)
    expect(text).toContain(`backend/${USERS}:3`)
  })

  test("unattended: the same finding is a repeat at the next stops, so the repeat limit holds", async () => {
    const { repo, root } = await createNested()
    const session = sessionAt(root, repo, "s1", { RULECAST_MODE: "unattended" })
    await session.write(USERS, VIOLATION)
    await session.send({ kind: "edit", files: [USERS] })
    // Edited again, the same finding: still the one the stops have counted.
    await session.write(USERS, VIOLATION)
    await session.send({ kind: "edit", files: [USERS] })
    const stops = []
    for (let i = 0; i < 3; i++) stops.push((await session.send({ kind: "verify", files: [] })).stop)
    expect(stops).toEqual(["block", "block", "report"])
  })
})
