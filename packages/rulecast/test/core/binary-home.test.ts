import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { BINARY_TARGETS, hostTarget } from "../../scripts/build-binary"
import { CACHE_HOME_SH, installOneLiner, TARGET_SH } from "../../src/core/binary-home"
import { cacheHome, type Env } from "../../src/core/home"

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
      const bin = stubs({ uname: `case "$1" in -s) echo ${os};; -m) echo ${machine};; esac` })
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
        : `for a in "$@"; do case "$a" in -*) ;; *) cp "${assets}/$(basename "$a")" . || exit 22;; esac; done`
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
    // Pasted into a shell as one argument.
    expect(line.startsWith("sh -c '")).toBe(true)
    expect(line.slice("sh -c '".length, -1)).not.toContain("'")
  })
})
