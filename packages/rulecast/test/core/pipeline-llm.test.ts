import { writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import type { Event } from "../../src/core/types"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { stubAgentCli, stubArgv, stubStdin } from "../helpers/llm"
import { pipelineAt } from "../helpers/pipeline"

const FILES = ["app/a.py", "app/b.py", "app/c.py", "app/d.py"]

const RULES = [
  {
    id: "py/thin",
    name: "Thin routes",
    files: "^app/",
    detect: { llm: { model: "haiku", question: "Does this do too much?" } },
    message: "{{file}}:{{line}} does too much. {{reason}}",
  },
]

async function scenario(settings: Record<string, unknown> = {}) {
  const files: Record<string, string> = {
    ".rulecast-config.yaml": localConfig(RULES, { llm: { max_files_per_verify: 2 }, ...settings }),
  }
  for (const file of FILES) files[file] = "def get(id):\n    return id\n"
  const root = await createRepo(files)
  await stubAgentCli(root, "claude")
  const send = (event: Omit<Event, "cwd">) => pipelineAt(root, { ...event, cwd: root })
  return { root, send }
}

describe("pipeline: the llm file budget", () => {
  beforeEach(() => vi.stubEnv("PATH", "/usr/bin:/bin"))
  afterEach(() => vi.unstubAllEnvs())

  test("a verify checks the most recently edited files and names the rest in a warning", async () => {
    const { root, send } = await scenario()
    const session = { id: "s1" }
    // Edited oldest to newest: d is the most recent.
    for (const file of ["app/a.py", "app/b.py", "app/c.py", "app/d.py"]) {
      await writeFile(path.join(root, file), `def get(id):\n    return id + "${file}"\n`)
      await send({ kind: "edit", files: [file], session })
    }

    const result = await send({ kind: "verify", files: [], session })
    const asked = (await stubStdin(root, "claude")).map((prompt) => /## File: (\S+)/.exec(prompt)![1])
    expect(asked.sort()).toEqual(["app/c.py", "app/d.py"])

    const warning = result.delivery.warnings.find((text) => text.includes("llm"))
    expect(warning).toContain("app/b.py")
    expect(warning).toContain("app/a.py")
    expect(warning).not.toContain("app/c.py")
    // Staying inside a budget the project set is not a rulecast failure.
    expect(result.failed).toBe(false)
  })

  test("under the limit there is no warning", async () => {
    const { root, send } = await scenario({ llm: { max_files_per_verify: 10 } })
    const session = { id: "s2" }
    await writeFile(path.join(root, "app/a.py"), "def get(id):\n    return 1\n")
    await send({ kind: "edit", files: ["app/a.py"], session })
    const result = await send({ kind: "verify", files: [], session })
    expect(result.delivery.warnings.filter((text) => text.includes("not checked"))).toEqual([])
    expect(await stubArgv(root, "claude")).toHaveLength(1)
  })

  test("--no-llm skips the rules before the budget ever sees them", async () => {
    const { root, send } = await scenario()
    const session = { id: "s3" }
    for (const file of FILES) {
      await writeFile(path.join(root, file), "def get(id):\n    return 1\n")
      await send({ kind: "edit", files: [file], session })
    }
    const result = await pipelineAt(
      root,
      { kind: "verify", files: [], session, cwd: root },
      { skipDetectorKinds: new Set(["llm"]) },
    )
    expect(await stubArgv(root, "claude")).toEqual([])
    expect(result.delivery.warnings).toEqual([])
  })
})
