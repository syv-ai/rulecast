import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeAll, describe, expect, test } from "vitest"

import { buildBinary } from "../scripts/build-binary"
import { VERSION } from "../src/core/version"
import { localConfig } from "./helpers/config"
import { createRepo } from "./helpers/git"
import { TEST_HOME } from "./helpers/home"

const hasBun = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0
/**
 * A prebuilt binary needs no bun; without one, the describe builds its own and so needs bun.
 * Set-but-missing still runs, so beforeAll can fail loudly rather than skipping the check CI
 * relies on.
 */
const prebuilt = process.env.RULECAST_BINARY
const canRun = hasBun || prebuilt !== undefined

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

const TS_RULE = {
  id: "no-console-log",
  name: "No console.log",
  files: "\\.ts$",
  detect: { "ast-grep": { language: "typescript", rule: { pattern: "console.log($A)" } } },
  message: "{{file}}:{{line}} logs.",
}

/**
 * Spec §16's early risk: the standalone binary has to embed @ast-grep/napi's native module and
 * @ast-grep/lang-python's prebuilt parser. Under Node both are loaded from absolute paths inside
 * node_modules. The binary is built outside the repository and run from a temp directory, but
 * this machine still has those paths, so the test below also checks that none is baked in.
 */
describe.runIf(canRun)("standalone binary", () => {
  let binary: string

  beforeAll(async () => {
    // CI builds the binary once per platform with `pnpm binary` and points this at it; locally,
    // with nothing set, it builds its own. One definition of "the binary works" for both.
    if (prebuilt !== undefined) {
      // Never fall back to building: CI sets this to the artifact the job just produced, and the
      // whole point of the job is to catch a name or path that does not match. Building our own
      // would make it green on exactly that mistake.
      if (!existsSync(prebuilt)) throw new Error(`RULECAST_BINARY is set to ${prebuilt}, which does not exist`)
      binary = prebuilt
      return
    }
    const out = await mkdtemp(path.join(tmpdir(), "rulecast-binary-"))
    binary = path.join(out, "rulecast")
    await buildBinary(binary)
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

  /**
   * The binary is tested on the machine that built it, where any path baked in at build time still
   * exists. 0.8.0 shipped binaries that looked for the Python parser in the build machine's
   * node_modules, and every ast-grep rule failed everywhere else. No absolute path from here may be
   * in the binary.
   */
  test("carries no path from the machine that built it", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..")
    expect(readFileSync(binary).includes(Buffer.from(repoRoot))).toBe(false)
  })

  test("runs TypeScript and Python ast-grep rules, unpacking the parser into the cache home once", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "rulecast-binary-home-"))
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([PY_RULE, TS_RULE]),
      "app/a.py": "def f():\n    try:\n        g()\n    except ValueError:\n        pass\n",
      "app/b.ts": "console.log(1)\n",
    })
    const run = () =>
      spawnSync(binary, ["run", "--all-files", "--format", "agent"], {
        cwd: root,
        env: { ...process.env, RULECAST_HOME: home },
        encoding: "utf8",
      })
    const first = run()
    expect(first.stdout).toContain("app/a.py:4 swallows an exception.")
    expect(first.stdout).toContain("app/b.ts:1 logs.")
    expect(first.status).toBe(1)
    const native = path.join(home, "native", `${VERSION}-${process.platform}-${process.arch}`)
    expect(readdirSync(native)).toEqual(["python.so"])
    const written = statSync(path.join(native, "python.so")).mtimeMs
    expect(run().status).toBe(1)
    expect(statSync(path.join(native, "python.so")).mtimeMs).toBe(written)
  }, 60_000)
})
