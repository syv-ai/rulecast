import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import type { Event, WriteIntent } from "../../src/core/types"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

/**
 * Spec §13: an edit has 350 ms and an agent waiting on it. `regex` matches inside a `vm` timeout,
 * which V8 honours; `ast-grep` parses in native code, which `TerminateExecution` does not reach, so
 * nothing preempts it — 2.6 MB measured 762 ms and the cost is linear. `max_file_bytes` keeps a
 * file that large away from the detectors that run in this process, on edit and on guard.
 *
 * verify has seconds to spend, so it always runs. Skipping is logged, not warned about: it is the
 * same category as a missed edit deadline, and must not mark the run failed.
 */
const FILE = "src/big.ts"

const RULES = [
  {
    id: "scale/compute",
    name: "No bare compute",
    files: "\\.ts$",
    detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
    refuse_write: true,
    message: "{{file}}:{{line}} calls compute({{n}}).",
  },
]

/** Well over a 1 KiB ceiling and far under the real 1 MiB one, so the tests stay fast. */
const BIG = "const value = compute(1)\n".repeat(400)
const SMALL = "const value = compute(1)\n"

async function repo(settings: Record<string, unknown> = {}): Promise<string> {
  const root = await createRepo({ ".rulecast-config.yaml": localConfig(RULES, settings), [FILE]: "// placeholder\n" })
  await writeFile(path.join(root, FILE), BIG)
  return root
}

const send = (root: string, event: Omit<Event, "cwd">, log?: (line: string) => void) =>
  pipelineAt(root, { ...event, cwd: root }, { log })

describe("pipeline: the file-size ceiling on edit", () => {
  test("a file over the ceiling is not given to an in-process detector, and that is not a failure", async () => {
    const lines: string[] = []
    const root = await repo({ max_file_bytes: 1024 })
    const result = await send(root, { kind: "edit", files: [FILE], session: { id: "over" } }, (line) =>
      lines.push(line),
    )

    expect(result.delivery.findings).toEqual([])
    expect(result.failed).toBe(false)
    expect(result.delivery.warnings).toEqual([])
    expect(lines.join("\n")).toContain(`over max_file_bytes (1024), not checked on this edit: ${FILE}`)
  })

  test("verify has seconds to spend, so it checks the same file anyway", async () => {
    const root = await repo({ max_file_bytes: 1024 })
    const result = await send(root, { kind: "verify", files: [FILE], session: { id: "verify" } })

    expect(result.delivery.findings.length).toBeGreaterThan(0)
    expect(result.failed).toBe(false)
  })

  test("under the ceiling an edit is checked as it always was", async () => {
    const root = await repo({ max_file_bytes: 1024 })
    await writeFile(path.join(root, FILE), SMALL)
    const result = await send(root, { kind: "edit", files: [FILE], session: { id: "under" } })

    expect(result.delivery.findings.length).toBeGreaterThan(0)
  })

  test("the default ceiling is a megabyte, so an ordinary source file is unaffected", async () => {
    const root = await repo()
    const result = await send(root, { kind: "edit", files: [FILE], session: { id: "default" } })

    expect(result.delivery.findings.length).toBeGreaterThan(0)
  })
})

describe("pipeline: the file-size ceiling on guard", () => {
  const guard = (root: string, intent: WriteIntent, session: string): Event => ({
    kind: "guard",
    files: [FILE],
    cwd: root,
    session: { id: session },
    intent,
  })

  test("a proposal over the ceiling allows the write rather than parsing it ahead of the agent", async () => {
    const lines: string[] = []
    const root = await repo({ max_file_bytes: 1024 })
    const delivery = (
      await pipelineAt(root, guard(root, { content: BIG }, "guard-over"), { log: (line) => lines.push(line) })
    ).delivery

    expect(delivery.findings).toEqual([])
    expect(lines.join("\n")).toContain(`guard: ${FILE} is over max_file_bytes (1024); allowing the write`)
  })

  test("the ceiling is measured on the proposed text, not the file on disk", async () => {
    // The file on disk is over the ceiling; what the agent proposes writing is not, and that is
    // what a detector would parse — so the guard still has its say.
    const root = await repo({ max_file_bytes: 1024 })
    const delivery = (await pipelineAt(root, guard(root, { content: SMALL }, "guard-under"))).delivery

    expect(delivery.findings.length).toBeGreaterThan(0)
  })
})
