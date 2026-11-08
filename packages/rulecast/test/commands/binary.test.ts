import { realpathSync } from "node:fs"
import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { installOneLiner } from "../../src/core/binary-home"
import { VERSION } from "../../src/core/version"
import { runCli } from "../helpers/cli"
import { breakInstalledBinary, lookupSetup } from "../helpers/lookup"
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

  test("binary path is none when the installed binary cannot run on this machine", async () => {
    const root = await createProject({})
    const setup = lookupSetup(["binary"], root)
    breakInstalledBinary(setup)
    expect(await runCli(root, ["binary", "path"], "", { RULECAST_HOME: setup.home })).toMatchObject({
      code: 1,
      stdout: "none\n",
    })
  })

  test("binary path names a working installed binary and its version", async () => {
    const root = await createProject({})
    const setup = lookupSetup(["binary"], root)
    expect(await runCli(root, ["binary", "path"], "", { RULECAST_HOME: setup.home })).toMatchObject({
      code: 0,
      stdout: `${realpathSync(setup.file.binary)} 0.8.2\n`,
    })
  })

  test("an unknown subcommand is a usage error", async () => {
    const result = await runCli(await createProject({}), ["binary", "fetch"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('unknown binary command "fetch"')
  })
})
