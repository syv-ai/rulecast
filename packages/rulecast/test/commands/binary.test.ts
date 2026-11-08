import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { installOneLiner } from "../../src/core/binary-home"
import { VERSION } from "../../src/core/version"
import { runCli } from "../helpers/cli"
import { createProject } from "../helpers/project"

describe("rulecast binary", () => {
  test("under node, binary install prints the one-liner and installs nothing", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "rulecast-binary-cmd-"))
    const result = await runCli(await createProject({}), ["binary", "install"], "", { RULECAST_HOME: home })
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("rulecast binary install is for the standalone binary; this rulecast runs on node")
    expect(result.stderr).toContain(installOneLiner(VERSION))
    expect(await readdir(home)).toEqual([])
  })

  test("binary path is none when nothing is installed", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "rulecast-binary-cmd-"))
    expect(await runCli(await createProject({}), ["binary", "path"], "", { RULECAST_HOME: home })).toMatchObject({
      code: 1,
      stdout: "none\n",
    })
  })

  test("an unknown subcommand is a usage error", async () => {
    const result = await runCli(await createProject({}), ["binary", "fetch"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('unknown binary command "fetch"')
  })
})
