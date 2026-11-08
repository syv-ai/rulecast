import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { hostTarget } from "../scripts/build-binary"

/**
 * install.sh, run as a developer runs it: `sh install.sh`, with a stub `curl` serving a fake release
 * from a scratch directory, a scratch HOME and TMPDIR, and a PATH holding only the tools it needs.
 */
const SCRIPT = fileURLToPath(new URL("../../../install.sh", import.meta.url))

const TOOLS = ["sh", "mktemp", "cp", "chmod", "mv", "rm", "mkdir", "grep", "cat", "uname", "basename"]
const SHA_TOOLS = ["shasum", "sha256sum"]

function scratch(name: string): string {
  return mkdtempSync(path.join(tmpdir(), `rulecast-install-${name}-`))
}

/** A directory of links to the real tools, leaving out `omit`. */
function toolsDir(omit: string[] = []): string {
  const dir = scratch("tools")
  for (const tool of [...TOOLS, ...SHA_TOOLS, "curl"]) {
    if (omit.includes(tool) || tool === "curl") continue
    const real = spawnSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim()
    if (real) symlinkSync(real, path.join(dir, tool))
  }
  return dir
}

function script(dir: string, name: string, body: string): void {
  writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`)
  chmodSync(path.join(dir, name), 0o755)
}

interface Run {
  status: number | null
  stdout: string
  stderr: string
  home: string
  tmp: string
}

/**
 * Runs install.sh against a fake release of version 9.9.9 for this machine. `sha256` replaces the
 * published checksum; `curlExit` makes every download fail as a missing asset does (curl -f: 22).
 */
function install(
  options: {
    env?: Record<string, string>
    home?: string
    sha256?: string
    curlExit?: number
    omit?: string[]
    uname?: string
    shell?: string
    /** Directories put on the PATH before the stubs and tools. */
    pathFirst?: string
  } = {},
): Run {
  const assets = scratch("release")
  const asset = `rulecast-${hostTarget()}`
  const body = `#!/bin/sh\n[ "$1" = --version ] && echo 9.9.9\n`
  writeFileSync(path.join(assets, asset), body)
  const hash = options.sha256 ?? createHash("sha256").update(body).digest("hex")
  writeFileSync(path.join(assets, `${asset}.sha256`), `${hash}  ${asset}\n`)
  const stubs = scratch("stubs")
  if (!options.omit?.includes("curl")) {
    script(
      stubs,
      "curl",
      options.curlExit !== undefined
        ? `exit ${options.curlExit}`
        : `for a in "$@"; do case "$a" in -*|=*) ;; *) cp "${assets}/$(basename "$a")" . || exit 22;; esac; done`,
    )
  }
  if (options.uname) script(stubs, "uname", `echo "${options.uname}"`)
  const home = options.home ?? scratch("home")
  const tmp = scratch("tmp")
  const result = spawnSync(options.shell ?? "/bin/sh", [SCRIPT], {
    env: {
      HOME: home,
      TMPDIR: tmp,
      PATH: `${options.pathFirst ? `${options.pathFirst}:` : ""}${stubs}:${toolsDir(options.omit)}`,
      SHELL: "/bin/bash",
      ...options.env,
    },
    encoding: "utf8",
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, home, tmp }
}

const bin = (home: string) => path.join(home, ".local", "bin")
const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : null)
const SOURCE_LINE = '. "$HOME/.local/bin/env"'
const count = (text: string | null, line: string) => (text ?? "").split("\n").filter((l) => l === line).length

describe("install.sh", () => {
  test("installs only after the checksum passes, and leaves nothing behind", () => {
    const good = install()
    expect(good.status, good.stderr).toBe(0)
    expect(good.stdout).toContain(`installed rulecast 9.9.9 at ${bin(good.home)}/rulecast`)
    expect(spawnSync(path.join(bin(good.home), "rulecast"), ["--version"], { encoding: "utf8" }).stdout).toBe("9.9.9\n")
    expect(readdirSync(bin(good.home)).sort()).toEqual(["env", "rulecast"])
    expect(readdirSync(good.tmp)).toEqual([])

    const tampered = install({ sha256: "0".repeat(64) })
    expect(tampered.status).toBe(1)
    expect(tampered.stderr).toContain("does not match its checksum")
    expect(existsSync(bin(tampered.home))).toBe(false)
    expect(readdirSync(tampered.tmp)).toEqual([])

    const missing = install({ curlExit: 22 })
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain("could not download https://github.com/syv-ai/rulecast/releases/download/v")
    expect(existsSync(bin(missing.home))).toBe(false)
    expect(readdirSync(missing.tmp)).toEqual([])
  })

  test("installs into RULECAST_INSTALL_DIR, else XDG_BIN_HOME, else ~/.local/bin", () => {
    const own = scratch("own")
    expect(install({ env: { RULECAST_INSTALL_DIR: own, XDG_BIN_HOME: scratch("xdg") } }).status).toBe(0)
    expect(existsSync(path.join(own, "rulecast"))).toBe(true)
    const xdg = scratch("xdg")
    expect(install({ env: { RULECAST_INSTALL_DIR: "", XDG_BIN_HOME: xdg } }).status).toBe(0)
    expect(existsSync(path.join(xdg, "rulecast"))).toBe(true)
    const home = install()
    expect(existsSync(path.join(bin(home.home), "rulecast"))).toBe(true)
  })

  test("sets up the PATH once, in .profile and the shells' startup files that exist", () => {
    const home = scratch("home")
    writeFileSync(path.join(home, ".bashrc"), "# mine\n")
    writeFileSync(path.join(home, ".zshrc"), "# mine\n")
    const first = install({ home })
    expect(first.status, first.stderr).toBe(0)
    for (const file of [".profile", ".bashrc", ".zshrc"]) {
      expect(count(read(path.join(home, file)), SOURCE_LINE), file).toBe(1)
      expect(first.stdout).toContain(`in ${path.join(home, file)}`)
    }
    expect(read(path.join(home, ".bashrc"))).toMatch(/^# mine\n/)
    expect(existsSync(path.join(home, ".bash_profile"))).toBe(false)

    const before = [".profile", ".bashrc", ".zshrc"].map((file) => read(path.join(home, file)))
    const second = install({ home })
    expect(second.status).toBe(0)
    expect([".profile", ".bashrc", ".zshrc"].map((file) => read(path.join(home, file)))).toEqual(before)
    expect(second.stdout).not.toContain("to the PATH in")
  })

  test("a fresh account with zsh gets ~/.profile and ~/.zshrc", () => {
    const run = install({ env: { SHELL: "/bin/zsh" } })
    expect(run.status).toBe(0)
    expect(count(read(path.join(run.home, ".profile")), SOURCE_LINE)).toBe(1)
    expect(count(read(path.join(run.home, ".zshrc")), SOURCE_LINE)).toBe(1)
    expect(existsSync(path.join(run.home, ".bashrc"))).toBe(false)
  })

  test("with the dir already on the PATH, no startup file changes", () => {
    const home = scratch("home")
    const run = install({ home, pathFirst: bin(home), env: { SHELL: "/bin/zsh" } })
    expect(run.status, run.stderr).toBe(0)
    expect(readdirSync(home)).toEqual([".local"])
    expect(run.stdout).not.toContain("to the PATH in")
  })

  test("RULECAST_NO_MODIFY_PATH=1 changes no startup file and prints the line to add", () => {
    const run = install({ env: { RULECAST_NO_MODIFY_PATH: "1", SHELL: "/bin/zsh" } })
    expect(run.status).toBe(0)
    expect(readdirSync(run.home)).toEqual([".local"])
    expect(run.stdout).toContain(`Add this line to your shell's startup file: ${SOURCE_LINE}`)
  })

  test("GITHUB_PATH set: appends the dir there once", () => {
    const githubPath = path.join(scratch("gh"), "path")
    const home = scratch("home")
    expect(install({ home, env: { GITHUB_PATH: githubPath } }).status).toBe(0)
    expect(install({ home, env: { GITHUB_PATH: githubPath } }).status).toBe(0)
    expect(read(githubPath)).toBe(`${bin(home)}\n`)
  })

  test("sourcing <dir>/env puts the dir on the PATH once, also when sourced twice", () => {
    const run = install()
    const env = path.join(bin(run.home), "env")
    const result = spawnSync("/bin/sh", ["-c", `. "${env}"; . "${env}"; printf %s "$PATH"`], {
      env: { HOME: run.home, PATH: "/usr/bin:/bin" },
      encoding: "utf8",
    })
    expect(result.stdout).toBe(`${bin(run.home)}:/usr/bin:/bin`)
  })

  test("an unknown platform exits 1 naming it, writing nothing", () => {
    const run = install({ uname: "FreeBSD amd64" })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("no standalone binary for FreeBSD amd64")
    expect(readdirSync(run.home)).toEqual([])
  })

  test("no curl, or neither shasum nor sha256sum: exits 1 naming what is missing, writing nothing", () => {
    const noCurl = install({ omit: ["curl"] })
    expect(noCurl.status).toBe(1)
    expect(noCurl.stderr).toContain("curl is needed")
    expect(readdirSync(noCurl.home)).toEqual([])
    const noSha = install({ omit: SHA_TOOLS })
    expect(noSha.status).toBe(1)
    expect(noSha.stderr).toContain("shasum or sha256sum is needed")
    expect(readdirSync(noSha.home)).toEqual([])
  })

  test("is POSIX sh: parses, and installs under dash when there is one", () => {
    expect(spawnSync("/bin/sh", ["-n", SCRIPT]).status).toBe(0)
    const dash = spawnSync("/bin/sh", ["-c", "command -v dash"], { encoding: "utf8" }).stdout.trim()
    if (dash) expect(install({ shell: dash }).status).toBe(0)
  })
})
