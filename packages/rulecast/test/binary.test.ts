import { execFile, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { beforeAll, describe, expect, test } from "vitest"

import { localConfig } from "./helpers/config"
import { createRepo } from "./helpers/git"
import { TEST_HOME } from "./helpers/home"

const exec = promisify(execFile)
const hasBun = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0
/** A prebuilt binary needs no bun; without one, the describe builds its own and so does. */
const canRun = hasBun || (process.env.RULECAST_BINARY !== undefined && existsSync(process.env.RULECAST_BINARY))

const PY_RULE = {
  id: "no-silent-except",
  name: "No silent except",
  files: "\\.py$",
  detect: {
    "ast-grep": {
      language: "python",
      rule: { kind: "except_clause", has: { kind: "block", has: { kind: "pass_statement" } } },
    },
  },
  message: "{{file}}:{{line}} swallows an exception.",
}

/**
 * Spec §16's early risk: the standalone binary has to embed @ast-grep/napi's native module and
 * @ast-grep/lang-python's prebuilt parser. Both are loaded from absolute paths inside node_modules
 * under Node, so this proves bun's bundler rewrote them into the binary. The binary is built
 * outside the repository and run from a temp directory: nothing can resolve node_modules there.
 */
describe.runIf(canRun)("standalone binary", () => {
  let binary: string

  beforeAll(async () => {
    // CI builds the binary once per platform with `pnpm binary` and points this at it; locally,
    // with nothing set, it builds its own. One definition of "the binary works" for both.
    const prebuilt = process.env.RULECAST_BINARY
    if (prebuilt !== undefined && existsSync(prebuilt)) {
      binary = prebuilt
      return
    }
    await exec("pnpm", ["build"])
    const out = await mkdtemp(path.join(tmpdir(), "rulecast-binary-"))
    binary = path.join(out, "rulecast")
    await exec("bun", ["build", path.resolve("dist/cli.js"), "--compile", "--outfile", binary])
  }, 180_000)

  test("matches a Python ast-grep rule with no node_modules in reach", async () => {
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([PY_RULE]),
      "app/a.py": "def f():\n    try:\n        g()\n    except ValueError:\n        pass\n",
    })
    const result = spawnSync(binary, ["run", "--all-files", "--format", "agent"], {
      cwd: root,
      env: { ...process.env, RULECAST_HOME: TEST_HOME },
      encoding: "utf8",
    })
    expect(result.stderr).not.toContain("Cannot find module")
    expect(result.stdout).toContain("app/a.py:4 swallows an exception.")
    expect(result.status).toBe(1)
  }, 60_000)
})
