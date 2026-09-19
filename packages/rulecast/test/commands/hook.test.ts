import { existsSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { hookCommand } from "../../src/commands/hook"
import { createRegistry } from "../../src/core/detection/registry"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { captureIo, runCli } from "../helpers/cli"
import { createFixture, fixtureFiles } from "../helpers/fixture"
import { createRepo } from "../helpers/git"
import { claudeCodePayload } from "../helpers/payloads"
import { createProject } from "../helpers/project"

const USERS = "app/services/users.py"
const VIOLATION = "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n"

function hook(root: string, name: string, file?: string) {
  const payload = claudeCodePayload(name, { root, file, sessionId: "s1" })
  return runCli(root, ["hook", "claude-code"], JSON.stringify(payload))
}

const additionalContext = (stdout: string): string => JSON.parse(stdout).hookSpecificOutput.additionalContext

describe("rulecast hook claude-code", () => {
  test("a read delivers the conventions for the file", async () => {
    const root = await createFixture()
    const result = await hook(root, "post-tool-use.read.complete", USERS)
    expect(result.code).toBe(0)
    expect(additionalContext(result.stdout)).toContain("--- conventions/backend.md#services ---")
    expect(readFileSync(path.join(root, ".rulecast/.state/.gitignore"), "utf8")).toBe("*\n")
  })

  test("an edit reports the new violation and Stop blocks on it", async () => {
    const root = await createFixture()
    await hook(root, "post-tool-use.read.complete", USERS)
    await writeFile(path.join(root, USERS), VIOLATION)
    expect(additionalContext((await hook(root, "post-tool-use.edit", USERS)).stdout)).toContain(
      "raises HTTPException(500)",
    )
    const stop = JSON.parse((await hook(root, "stop")).stdout)
    expect(stop.decision).toBe("block")
    expect(stop.reason).toContain("raises HTTPException(500)")
  })

  test("the compaction summariser's SubagentStop is not verified", async () => {
    const root = await createFixture()
    await writeFile(path.join(root, USERS), VIOLATION)
    await hook(root, "post-tool-use.edit", USERS)
    expect(await hook(root, "subagent-stop.compaction")).toMatchObject({ code: 0, stdout: "" })
  })

  test("outside a rulecast project the hook does nothing and creates no state", async () => {
    const root = await createProject({ [USERS]: VIOLATION })
    expect(await hook(root, "post-tool-use.edit", USERS)).toMatchObject({ code: 0, stdout: "", stderr: "" })
    expect(existsSync(path.join(root, ".rulecast"))).toBe(false)
  })

  test("files outside the project are ignored", async () => {
    const root = await createFixture()
    const payload = claudeCodePayload("post-tool-use.edit", { root, sessionId: "s1" })
    payload.tool_input = { file_path: "/elsewhere/app/services/users.py" }
    expect(await runCli(root, ["hook", "claude-code"], JSON.stringify(payload))).toMatchObject({ code: 0, stdout: "" })
  })

  test("bad input and unknown adapters fail open", async () => {
    const root = await createFixture()
    const garbage = await runCli(root, ["hook", "claude-code"], "not json")
    expect(garbage.code).toBe(0)
    expect(garbage.stderr).toContain("could not read hook input")
    const unknown = await runCli(root, ["hook", "cursor"], "{}")
    expect(unknown.code).toBe(0)
    expect(unknown.stderr).toContain('unknown hook adapter "cursor"')
  })
})

describe("rulecast hook warm-up", () => {
  const schema = z.object({}).strict()
  /** Never finishes a run, and has warm-up work. */
  const slow: Detector<z.infer<typeof schema>> = {
    kind: "slow",
    schema,
    captures: () => [],
    events: () => ["edit", "verify"],
    run: () => new Promise(() => {}),
    warm: async () => {},
  }
  const registry = createRegistry([...builtinDetectors, slow])
  const slowProject = () =>
    createRepo({
      ...fixtureFiles,
      ".rulecast/config.yml": "timeouts:\n  editDeadlineMs: 20\n",
      ".rulecast/rules/slow.yml": "id: slow/rule\nfiles: app/**/*.py\ndetect: { slow: {} }\nmessage: m\n",
    })

  async function run(root: string, name: string, withRegistry = registry, file?: string) {
    const { io, output } = captureIo(root, JSON.stringify(claudeCodePayload(name, { root, file, sessionId: "s1" })))
    expect(await hookCommand(["claude-code"], withRegistry, io)).toBe(0)
    return output
  }

  test("session start warms detectors that have warm-up work", async () => {
    const root = await slowProject()
    expect((await run(root, "session-start.startup")).warmed).toEqual([{ root, kinds: ["slow"] }])
  })

  test("a detector that missed the edit deadline is warmed in the background", async () => {
    const root = await slowProject()
    expect((await run(root, "post-tool-use.edit", registry, USERS)).warmed).toEqual([{ root, kinds: ["slow"] }])
  })

  test("without warm-up work nothing is started", async () => {
    const root = await createFixture()
    expect((await run(root, "session-start.startup", createRegistry([...builtinDetectors]))).warmed).toEqual([])
  })
})
