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
 * Spec §14: a store that cannot be read runs the invocation without session state and warns. It
 * did not — `CorruptStoreError` was thrown out of `runPipeline`, so the hook crashed.
 *
 * `core/jsonl.ts` tolerates an unparseable *last* line, because only a crash mid-append can leave
 * one. A half-written record anywhere else is a `CorruptStoreError`, and `pipeline.ts` caught only
 * `LockTimeoutError` — the other half of the same row in §14's table.
 */
async function corrupt(root: string, file: string): Promise<void> {
  const store = path.join(sessionDir(stateDirFor(root), SESSION), file)
  const text = await readFile(store, "utf8")
  await writeFile(store, `${text.trimEnd()}\n{"t":"edited","fi\n{"t":"prompt","agent":"main"}\n`)
}

const send = (root: string, event: Omit<Event, "cwd" | "session">) =>
  pipelineAt(root, { ...event, cwd: root, session: { id: SESSION } })

describe("pipeline with an unreadable session store", () => {
  test("a half-written record mid-file delivers without session memory instead of throwing", async () => {
    const root = await createFixture()
    await send(root, { kind: "edit", files: [USERS] })
    await corrupt(root, "work.jsonl")

    await writeFile(path.join(root, USERS), "def get():\n    raise HTTPException(418)\n")
    const { delivery } = await send(root, { kind: "edit", files: [USERS] })

    expect(delivery.warnings).toContain("session state could not be read; delivered without session memory")
    // Detection still runs: the point of failing open is that the agent still hears about the rule.
    expect(delivery.findings.map((finding) => finding.rule)).toEqual(["backend/no-httpexception"])
  })

  test("a corrupt baseline is handled the same way", async () => {
    const root = await createFixture()
    await send(root, { kind: "touch", files: [USERS], completeRead: true })
    await corrupt(root, "baseline.jsonl")

    const { delivery } = await send(root, { kind: "edit", files: [USERS] })
    expect(delivery.warnings).toContain("session state could not be read; delivered without session memory")
  })
})
