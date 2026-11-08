import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeAll, describe, expect, test } from "vitest"

import { buildBinary } from "../scripts/build-binary"
import { binaryPath, currentBinaryPath } from "../src/core/binary-home"
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
    expect(readdirSync(native).sort()).toEqual(["napi.node", "python.so"])
    const written = statSync(path.join(native, "python.so")).mtimeMs
    expect(run().status).toBe(1)
    expect(statSync(path.join(native, "python.so")).mtimeMs).toBe(written)
  }, 60_000)

  test("the napi module is unpacked into the cache home once", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "rulecast-binary-home-"))
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([TS_RULE]),
      "app/b.ts": "console.log(1)\n",
    })
    const run = () =>
      spawnSync(binary, ["run", "--all-files", "--format", "agent"], {
        cwd: root,
        env: { ...process.env, RULECAST_HOME: home },
        encoding: "utf8",
      })
    expect(run().stdout).toContain("app/b.ts:1 logs.")
    const napi = path.join(home, "native", `${VERSION}-${process.platform}-${process.arch}`, "napi.node")
    const written = statSync(napi).mtimeMs
    expect(run().stdout).toContain("app/b.ts:1 logs.")
    expect(statSync(napi).mtimeMs).toBe(written)
  }, 60_000)

  /**
   * The binary points napi-rs's loader at its own ast-grep module with NAPI_RS_NATIVE_LIBRARY_PATH.
   * A project's napi-rs tools (vite, vitest, knip, tailwind) read the same variable: a command rule's
   * process must never see it, whether it starts before, during or after ast-grep loads.
   */
  test("a command rule's process does not inherit the binary's NAPI_RS_NATIVE_LIBRARY_PATH", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "rulecast-binary-home-"))
    const record = {
      id: "record-env",
      name: "Record env",
      files: "\\.ts$",
      detect: {
        command: {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell parameter expansion.
          run: ["sh", "-c", 'printf "%s\\n" "${NAPI_RS_NATIVE_LIBRARY_PATH-unset}" >> seen.txt', "--"],
          output: { lines: "gcc" },
        },
      },
      message: "{{file}}:{{line}} recorded.",
    }
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([TS_RULE, record]),
      "app/b.ts": "console.log(1)\n",
    })
    for (let i = 0; i < 2; i++) {
      const result = spawnSync(binary, ["run", "--all-files", "--format", "agent"], {
        cwd: root,
        env: { ...process.env, RULECAST_HOME: home },
        encoding: "utf8",
      })
      expect(result.stdout).toContain("app/b.ts:1 logs.")
    }
    expect(readFileSync(path.join(root, "seen.txt"), "utf8")).toBe("unset\nunset\n")
  }, 60_000)

  test("binary install places it in the cache and links it as current, and a second install is a no-op", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "rulecast-binary-home-"))
    const env = { ...process.env, RULECAST_HOME: home }
    const install = () => spawnSync(binary, ["binary", "install"], { env, encoding: "utf8" })
    const placed = binaryPath(home, VERSION)
    // An older version for this machine is removed; one for another machine stays (a shared home).
    const older = path.join(path.dirname(binaryPath(home, "0.0.1")))
    const otherMachine = path.join(home, "bin", "0.0.1-plan9-mips")
    mkdirSync(older, { recursive: true })
    mkdirSync(otherMachine, { recursive: true })
    const first = install()
    expect(first.stderr).toBe("")
    expect(first.stdout).toContain(`rulecast: installed ${VERSION} at ${placed}`)
    expect(first.stdout).toContain("rulecast: removed the binary of 0.0.1\n")
    expect(existsSync(older)).toBe(false)
    expect(existsSync(otherMachine)).toBe(true)
    expect(first.status).toBe(0)
    expect(statSync(placed).mode & 0o111).not.toBe(0)
    expect(realpathSync(currentBinaryPath(home))).toBe(realpathSync(placed))
    // The native files are unpacked at install, not at the first edit.
    expect(readdirSync(path.join(home, "native", `${VERSION}-${process.platform}-${process.arch}`)).sort()).toEqual([
      "napi.node",
      "python.so",
    ])
    const second = install()
    expect(second).toMatchObject({ status: 0, stdout: `rulecast: ${VERSION} is already installed at ${placed}\n` })
    const where = spawnSync(binary, ["binary", "path"], { env, encoding: "utf8" })
    expect(where).toMatchObject({ status: 0, stdout: `${realpathSync(placed)} ${VERSION}\n` })
  }, 60_000)

  test("binary install into an unwritable home exits 2 and names the directory", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "rulecast-binary-home-"))
    writeFileSync(path.join(home, "bin"), "")
    const result = spawnSync(binary, ["binary", "install"], {
      env: { ...process.env, RULECAST_HOME: home },
      encoding: "utf8",
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(`could not install into ${path.join(home, "bin")}`)
  }, 60_000)

  test("a failed binary install leaves no partial file behind", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "rulecast-binary-home-"))
    // The current link's place is a directory with something in it: the binary copies, the link fails.
    mkdirSync(path.join(currentBinaryPath(home), "in-the-way"), { recursive: true })
    const result = spawnSync(binary, ["binary", "install"], {
      env: { ...process.env, RULECAST_HOME: home },
      encoding: "utf8",
    })
    expect(result.status).toBe(2)
    const left = readdirSync(path.join(home, "bin"), { recursive: true }) as string[]
    expect(left.filter((name) => name.endsWith(".tmp"))).toEqual([])
  }, 60_000)

  /**
   * The native directory cannot be made (a file is in its place), so the native files go to the
   * per-user temp directory. The home itself stays writable: every run keeps project state there.
   * With the temp directory unwritable too there is no way to load a native library at all, as
   * bun's own unpacking needs it as well, and the rules are reported as not run.
   */
  test("with no writable native directory in the cache home, ast-grep rules still run", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "rulecast-binary-ro-"))
    const home = path.join(scratch, "home")
    const tmp = path.join(scratch, "tmp")
    mkdirSync(home)
    mkdirSync(tmp)
    writeFileSync(path.join(home, "native"), "")
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([PY_RULE, TS_RULE]),
      "app/a.py": "def f():\n    try:\n        g()\n    except ValueError:\n        pass\n",
      "app/b.ts": "console.log(1)\n",
    })
    const result = spawnSync(binary, ["run", "--all-files", "--format", "agent"], {
      cwd: root,
      env: { ...process.env, RULECAST_HOME: home, TMPDIR: tmp },
      encoding: "utf8",
    })
    expect(result.stdout).toContain("app/b.ts:1 logs.")
    expect(result.stdout).toContain("app/a.py:4 swallows an exception.")
    const fallback = readdirSync(tmp).find((name) => name.startsWith("rulecast-native-"))!
    expect(readdirSync(path.join(tmp, fallback, `${VERSION}-${process.platform}-${process.arch}`)).sort()).toEqual([
      "napi.node",
      "python.so",
    ])
  }, 60_000)
})
