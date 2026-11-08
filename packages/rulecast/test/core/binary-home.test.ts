import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { parse } from "yaml"

import { BINARY_TARGETS, hostTarget } from "../../scripts/build-binary"
import {
  CACHE_HOME_SH,
  gitHookCommand,
  hookCacheHome,
  installOneLiner,
  probeRulecast,
  TARGET_SH,
} from "../../src/core/binary-home"
import { childEnv, markOwnEnv, unmarkOwnEnv } from "../../src/core/child-env"
import { cacheHome, type Env } from "../../src/core/home"
import { breakInstalledBinary, LOOKUP_FIXTURES, lookupSetup } from "../helpers/lookup"
import { createProject } from "../helpers/project"

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))

const BASE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"

function sh(script: string, env: Env): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("/bin/sh", ["-c", script], { env: env as NodeJS.ProcessEnv, encoding: "utf8" })
  return { stdout: result.stdout, stderr: result.stderr, status: result.status }
}

function scratch(name: string): string {
  return mkdtempSync(path.join(tmpdir(), `rulecast-${name}-`))
}

/** A directory holding executable scripts, to put first on the PATH. */
function stubs(files: Record<string, string>): string {
  const dir = scratch("stubs")
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`)
    chmodSync(path.join(dir, name), 0o755)
  }
  return dir
}

describe("CACHE_HOME_SH", () => {
  test.each<Env>([
    {},
    { RULECAST_HOME: "/r" },
    { XDG_CACHE_HOME: "/x" },
    { RULECAST_HOME: "", XDG_CACHE_HOME: "/x" },
    { RULECAST_HOME: "/r", XDG_CACHE_HOME: "/x" },
    { HOME: "/h" },
  ])("CACHE_HOME_SH resolves the home cacheHome does: %o", (env) => {
    // A hook always has the user's HOME; the case sets its own to show it is the one used.
    const full = { PATH: BASE_PATH, HOME: homedir(), ...env }
    expect(sh(`${CACHE_HOME_SH}; printf %s "$H"`, full).stdout).toBe(cacheHome(full))
  })
})

describe("probeRulecast", () => {
  test("a file the OS cannot execute is none, not a crash", async () => {
    const setup = lookupSetup(["binary"], await createProject({}))
    expect(await probeRulecast(setup.file.binary)).toEqual({ version: "0.8.2" })
    breakInstalledBinary(setup)
    expect(await probeRulecast(setup.file.binary)).toBeNull()
  })
})

describe("childEnv", () => {
  test("drops what rulecast set for itself, and keeps a value the user set", () => {
    markOwnEnv("NAPI_RS_NATIVE_LIBRARY_PATH", "/ours/napi.node")
    try {
      expect(childEnv({ NAPI_RS_NATIVE_LIBRARY_PATH: "/ours/napi.node", A: "1" })).toEqual({ A: "1" })
      expect(childEnv({ NAPI_RS_NATIVE_LIBRARY_PATH: "/theirs.node" })).toEqual({
        NAPI_RS_NATIVE_LIBRARY_PATH: "/theirs.node",
      })
    } finally {
      unmarkOwnEnv("NAPI_RS_NATIVE_LIBRARY_PATH")
    }
    expect(childEnv({ NAPI_RS_NATIVE_LIBRARY_PATH: "/ours/napi.node" })).toEqual({
      NAPI_RS_NATIVE_LIBRARY_PATH: "/ours/napi.node",
    })
  })
})

describe("hookCacheHome", () => {
  test("with HOME, XDG_CACHE_HOME and RULECAST_HOME all unset the shell names no home, and neither does hookCacheHome", () => {
    expect(sh(`${CACHE_HOME_SH}; printf %s "$H"`, { PATH: BASE_PATH }).stdout).toBe("")
    expect(hookCacheHome({})).toBeNull()
    expect(hookCacheHome({ HOME: "", XDG_CACHE_HOME: "" })).toBeNull()
    for (const env of [{ HOME: "/h" }, { XDG_CACHE_HOME: "/x" }, { RULECAST_HOME: "/r" }]) {
      expect(hookCacheHome(env)).toBe(sh(`${CACHE_HOME_SH}; printf %s "$H"`, { PATH: BASE_PATH, ...env }).stdout)
    }
  })
})

describe("TARGET_SH", () => {
  const unames: [string, string, string | null][] = [
    ["Linux", "x86_64", "linux-x64"],
    ["Linux", "aarch64", "linux-arm64"],
    ["Darwin", "arm64", "darwin-arm64"],
    ["Darwin", "x86_64", "darwin-x64"],
    ["MINGW64_NT-10.0", "x86_64", null],
  ]

  test("TARGET_SH names every shipped target and nothing else", () => {
    const named = new Set<string>()
    for (const [os, machine, target] of unames) {
      const bin = stubs({
        uname: `case "$1" in -sm) echo "${os} ${machine}";; -s) echo ${os};; -m) echo ${machine};; esac`,
      })
      const result = sh(`${TARGET_SH}; printf %s "$T"`, { PATH: `${bin}:${BASE_PATH}` })
      if (target === null) {
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain("no standalone binary")
      } else {
        expect(result).toMatchObject({ status: 0, stdout: target })
        named.add(target)
      }
    }
    expect([...named].sort()).toEqual([...BINARY_TARGETS].sort())
  })
})

describe("gitHookCommand", () => {
  test(".pre-commit-hooks.yaml runs rulecast as the agent hooks find it", () => {
    const hooks = parse(readFileSync(path.join(repoRoot, ".pre-commit-hooks.yaml"), "utf8")) as {
      id: string
      entry: string
    }[]
    expect(Object.fromEntries(hooks.map((hook) => [hook.id, hook.entry]))).toEqual({
      rulecast: gitHookCommand("run"),
      "rulecast-push": gitHookCommand('run --from-ref "$PRE_COMMIT_FROM_REF" --to-ref "$PRE_COMMIT_TO_REF"'),
    })
  })

  test.each(LOOKUP_FIXTURES)(
    "the git-hook resolver prefers the project's, then the installed binary, then the PATH: $name",
    async ({ places, runs }) => {
      const root = await createProject({})
      const { home, pathDir } = lookupSetup(places, root)
      // pre-commit's entry is split like a shell would; the command is `sh -c <script> --`.
      const script = gitHookCommand("run").slice("sh -c '".length, -"' --".length)
      const result = spawnSync("/bin/sh", ["-c", script, "--"], {
        cwd: root,
        env: { PATH: `${pathDir}:${BASE_PATH}`, RULECAST_HOME: home },
        encoding: "utf8",
      })
      expect(result.stdout).toBe(`{"${runs}":true}\n`)
      expect(readFileSync(path.join(root, `ran-${runs}`), "utf8")).toBe("run\n")
    },
  )

  test("an installed binary killed by a signal fails the git hook: the PATH rulecast does not run too", async () => {
    const root = await createProject({})
    const setup = lookupSetup(["binary", "path"], root)
    writeFileSync(realpathSync(setup.file.binary), "#!/bin/sh\nkill -SEGV $$\n")
    const script = gitHookCommand("run").slice("sh -c '".length, -"' --".length)
    const result = spawnSync("/bin/sh", ["-c", script, "--"], {
      cwd: root,
      env: { PATH: `${setup.pathDir}:${BASE_PATH}`, RULECAST_HOME: setup.home },
      encoding: "utf8",
    })
    expect(result.status).toBe(139)
    expect(existsSync(path.join(root, "ran-path"))).toBe(false)
  })

  test("an installed binary that cannot run on this machine falls through to the PATH", async () => {
    const root = await createProject({})
    const setup = lookupSetup(["binary", "path"], root)
    breakInstalledBinary(setup)
    const script = gitHookCommand("run").slice("sh -c '".length, -"' --".length)
    const result = spawnSync("/bin/sh", ["-c", script, "--"], {
      cwd: root,
      env: { PATH: `${setup.pathDir}:${BASE_PATH}`, RULECAST_HOME: setup.home },
      encoding: "utf8",
    })
    expect(result.stdout).toBe('{"path":true}\n')
  })
})

describe("installOneLiner", () => {
  /**
   * A release with the host's asset and its checksum, a `curl` that serves it, and a "binary" that
   * records what it was asked to do. `sha256` replaces the published checksum; `curlExit` makes
   * every download fail as a missing asset does (curl -f exits 22).
   */
  function release(options: { sha256?: string; curlExit?: number } = {}) {
    const target = hostTarget()
    const assets = scratch("release")
    const record = path.join(scratch("record"), "ran")
    const asset = `rulecast-${target}`
    const body = `#!/bin/sh\necho "$@" >> ${JSON.stringify(record)}\n`
    writeFileSync(path.join(assets, asset), body)
    const hash = options.sha256 ?? createHash("sha256").update(body).digest("hex")
    writeFileSync(path.join(assets, `${asset}.sha256`), `${hash}  ${asset}\n`)
    const curl =
      options.curlExit !== undefined
        ? `exit ${options.curlExit}`
        : `for a in "$@"; do case "$a" in -*|=*) ;; *) cp "${assets}/$(basename "$a")" . || exit 22;; esac; done`
    const bin = stubs({ curl })
    const result = sh(installOneLiner("9.9.9"), { PATH: `${bin}:${BASE_PATH}`, HOME: homedir() })
    return { result, ran: existsSync(record) ? readFileSync(record, "utf8") : null }
  }

  test("the one-liner installs only after the checksum passes", () => {
    const good = release()
    expect(good.result.status).toBe(0)
    expect(good.ran).toBe("binary install\n")

    const tampered = release({ sha256: "0".repeat(64) })
    expect(tampered.result.status).not.toBe(0)
    expect(tampered.ran).toBeNull()

    const missing = release({ curlExit: 22 })
    expect(missing.result.status).not.toBe(0)
    expect(missing.ran).toBeNull()
  })

  test("it fetches this version's assets from the project's releases", () => {
    const line = installOneLiner("1.2.3")
    expect(line).toContain("https://github.com/syv-ai/rulecast/releases/download/v1.2.3/rulecast-$T")
    expect(line).toContain("rulecast-$T.sha256")
    // Both downloads refuse to follow a redirect off https.
    expect(line.match(/curl --proto =https -fsSLO https:/g)).toHaveLength(2)
    // Pasted into a shell as one argument.
    expect(line.startsWith("sh -c '")).toBe(true)
    expect(line.slice("sh -c '".length, -1)).not.toContain("'")
  })
})
