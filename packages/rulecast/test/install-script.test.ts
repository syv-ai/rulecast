import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { BINARY_TARGETS, hostTarget } from "../scripts/build-binary"
import { installDir } from "../src/core/binary-home"
import { VERSION } from "../src/core/version"

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

/**
 * Runs a command without blocking: spawnSync would hold the test worker for every install, and a
 * worker held that long misses vitest's own calls (Timeout calling "onTaskUpdate").
 */
function run(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; encoding: "utf8" },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (status) => resolve({ status, stdout, stderr }))
  })
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
async function install(
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
    /** The released binary's text: by default a script that prints 9.9.9 for --version. */
    body?: string
    /** The whole .sha256 file, in place of a correct one. */
    shaFile?: string
    /** What the developer types, one answer per line: the script then has a terminal to ask through. */
    answers?: string
    /** Options after `sh install.sh`. */
    args?: string[]
  } = {},
): Promise<Run> {
  const assets = scratch("release")
  const asset = `rulecast-${hostTarget()}`
  const body = options.body ?? `#!/bin/sh\n[ "$1" = --version ] && echo 9.9.9\n`
  writeFileSync(path.join(assets, asset), body)
  const hash = options.sha256 ?? createHash("sha256").update(body).digest("hex")
  writeFileSync(path.join(assets, `${asset}.sha256`), options.shaFile ?? `${hash}  ${asset}\n`)
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
  const tty = options.answers === undefined ? {} : { RULECAST_INSTALL_TTY: path.join(scratch("tty"), "answers") }
  if (tty.RULECAST_INSTALL_TTY) writeFileSync(tty.RULECAST_INSTALL_TTY, options.answers!)
  const result = await run(options.shell ?? "/bin/sh", [SCRIPT, ...(options.args ?? [])], {
    env: {
      HOME: home,
      TMPDIR: tmp,
      PATH: `${options.pathFirst ? `${options.pathFirst}:` : ""}${stubs}:${toolsDir(options.omit)}`,
      SHELL: "/bin/bash",
      ...tty,
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
  test("installs only after the checksum passes, and leaves nothing behind", async () => {
    const good = await install()
    expect(good.status, good.stderr).toBe(0)
    expect(good.stdout).toContain(`installed rulecast 9.9.9 at ${bin(good.home)}/rulecast`)
    expect(spawnSync(path.join(bin(good.home), "rulecast"), ["--version"], { encoding: "utf8" }).stdout).toBe("9.9.9\n")
    expect(readdirSync(bin(good.home)).sort()).toEqual(["env", "rulecast"])
    expect(readdirSync(good.tmp)).toEqual([])

    const tampered = await install({ sha256: "0".repeat(64) })
    expect(tampered.status).toBe(1)
    expect(tampered.stderr).toContain("does not match its checksum")
    expect(existsSync(bin(tampered.home))).toBe(false)
    expect(readdirSync(tampered.tmp)).toEqual([])

    const missing = await install({ curlExit: 22 })
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain("could not download https://github.com/syv-ai/rulecast/releases/download/v")
    expect(existsSync(bin(missing.home))).toBe(false)
    expect(readdirSync(missing.tmp)).toEqual([])
  })

  test("a checksum file that is empty or not a hash installs nothing", async () => {
    for (const shaFile of ["", "not a hash\n", "  rulecast\n"]) {
      const run = await install({ shaFile })
      expect(run.status, JSON.stringify(shaFile)).toBe(1)
      expect(run.stderr).toContain("checksum file is not a SHA-256 hash")
      expect(existsSync(bin(run.home))).toBe(false)
    }
  })

  test("a binary that does not run here replaces nothing", async () => {
    const home = scratch("home")
    expect((await install({ home })).status).toBe(0)
    const broken = await install({ home, body: "#!/bin/sh\nexit 1\n" })
    expect(broken.status).toBe(1)
    expect(broken.stderr).toContain("does not run on this machine; nothing was installed")
    // The working one is still there, and nothing half-done is left beside it.
    expect(spawnSync(path.join(bin(home), "rulecast"), ["--version"], { encoding: "utf8" }).stdout).toBe("9.9.9\n")
    expect(readdirSync(bin(home)).sort()).toEqual(["env", "rulecast"])
  })

  test("an install directory that is relative, or would break a startup file, is refused", async () => {
    for (const dir of ["bin", "~/bin", '/tmp/a"b', "/tmp/a$b", "/tmp/a`b"]) {
      const run = await install({ env: { RULECAST_INSTALL_DIR: dir } })
      expect(run.status, dir).toBe(1)
      expect(run.stderr).toMatch(/must be an absolute path|cannot contain/)
    }
  })

  test("a HOME with $, quotes or spaces still installs, its startup line naming it through $HOME", async () => {
    const home = path.join(scratch("odd"), 'a $b "c`')
    mkdirSync(home)
    const run = await install({ home, env: { SHELL: "/bin/zsh" } })
    expect(run.status, run.stderr).toBe(0)
    expect(count(read(path.join(home, ".zshrc")), SOURCE_LINE)).toBe(1)
    const env = path.join(bin(home), "env")
    const sourced = spawnSync("/bin/sh", ["-c", `. "${env.replace(/(["$`\\])/g, "\\$1")}"; printf %s "$PATH"`], {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      encoding: "utf8",
    })
    expect(sourced.stdout).toBe(`${bin(home)}:/usr/bin:/bin`)
  })

  test("installs into RULECAST_INSTALL_DIR, else XDG_BIN_HOME, else ~/.local/bin", async () => {
    const own = scratch("own")
    expect((await install({ env: { RULECAST_INSTALL_DIR: own, XDG_BIN_HOME: scratch("xdg") } })).status).toBe(0)
    expect(existsSync(path.join(own, "rulecast"))).toBe(true)
    const xdg = scratch("xdg")
    expect((await install({ env: { RULECAST_INSTALL_DIR: "", XDG_BIN_HOME: xdg } })).status).toBe(0)
    expect(existsSync(path.join(xdg, "rulecast"))).toBe(true)
    const home = await install()
    expect(existsSync(path.join(bin(home.home), "rulecast"))).toBe(true)
  })

  test("installs where installDir says, so doctor looks where the script put it", async () => {
    for (const env of <Record<string, string>[]>[
      { RULECAST_INSTALL_DIR: scratch("own"), XDG_BIN_HOME: scratch("xdg") },
      { RULECAST_INSTALL_DIR: "", XDG_BIN_HOME: scratch("xdg") },
      {},
    ]) {
      const home = scratch("home")
      expect((await install({ home, env })).status).toBe(0)
      expect(existsSync(path.join(installDir({ HOME: home, ...env }), "rulecast"))).toBe(true)
    }
  })

  test("sets up the PATH once, in .profile and the shells' startup files that exist", async () => {
    const home = scratch("home")
    writeFileSync(path.join(home, ".bashrc"), "# mine\n")
    writeFileSync(path.join(home, ".zshrc"), "# mine\n")
    const first = await install({ home })
    expect(first.status, first.stderr).toBe(0)
    for (const file of [".profile", ".bashrc", ".zshrc"]) {
      expect(count(read(path.join(home, file)), SOURCE_LINE), file).toBe(1)
      expect(first.stdout).toContain(`in ${path.join(home, file)}`)
    }
    expect(read(path.join(home, ".bashrc"))).toMatch(/^# mine\n/)
    expect(existsSync(path.join(home, ".bash_profile"))).toBe(false)

    const before = [".profile", ".bashrc", ".zshrc"].map((file) => read(path.join(home, file)))
    const second = await install({ home })
    expect(second.status).toBe(0)
    expect([".profile", ".bashrc", ".zshrc"].map((file) => read(path.join(home, file)))).toEqual(before)
    expect(second.stdout).not.toContain("to the PATH in")
    // Still not on this shell's PATH: the second run says how, too.
    expect(second.stdout).toContain(`to use rulecast in this shell now, run: ${SOURCE_LINE}`)
  })

  test("a fresh account with zsh gets ~/.profile and ~/.zshrc", async () => {
    const run = await install({ env: { SHELL: "/bin/zsh" } })
    expect(run.status).toBe(0)
    expect(count(read(path.join(run.home, ".profile")), SOURCE_LINE)).toBe(1)
    expect(count(read(path.join(run.home, ".zshrc")), SOURCE_LINE)).toBe(1)
    expect(existsSync(path.join(run.home, ".bashrc"))).toBe(false)
  })

  test("with the dir already on the PATH, no startup file changes", async () => {
    const home = scratch("home")
    const run = await install({ home, pathFirst: bin(home), env: { SHELL: "/bin/zsh" } })
    expect(run.status, run.stderr).toBe(0)
    expect(readdirSync(home)).toEqual([".local"])
    expect(run.stdout).not.toContain("to the PATH in")
  })

  test("RULECAST_NO_MODIFY_PATH=1 changes no startup file and prints the line to add", async () => {
    const run = await install({ env: { RULECAST_NO_MODIFY_PATH: "1", SHELL: "/bin/zsh" } })
    expect(run.status).toBe(0)
    expect(readdirSync(run.home)).toEqual([".local"])
    expect(run.stdout).toContain(`Add this line to your shell's startup file: ${SOURCE_LINE}`)
  })

  test("a directory with a space is printed so a pasted command keeps it whole", async () => {
    const dir = path.join(scratch("spaced"), "my bin")
    const run = await install({ env: { RULECAST_INSTALL_DIR: dir, SHELL: "/usr/bin/fish" } })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain(`for fish, run: fish_add_path "${dir}"\n`)
    expect(run.stdout).toContain(`to use rulecast in this shell now, run: . "${dir}/env"\n`)
    // Under HOME, through $HOME, as the startup files name it.
    const home = await install({ env: { SHELL: "/usr/bin/fish" } })
    expect(home.stdout).toContain('for fish, run: fish_add_path "$HOME/.local/bin"\n')
  })

  test("a directory given with trailing slashes is the same directory: one startup line, however it is spelt", async () => {
    for (const [first, second] of [
      ["", "/"],
      ["/", ""],
      ["", "//"],
      ["//", ""],
    ]) {
      const home = scratch("home")
      const dir = path.join(scratch("own"), "bin")
      expect((await install({ home, env: { RULECAST_INSTALL_DIR: `${dir}${first}` } })).status).toBe(0)
      const again = await install({ home, env: { RULECAST_INSTALL_DIR: `${dir}${second}` } })
      expect(again.status, again.stderr).toBe(0)
      expect(again.stdout, `${first} then ${second}`).not.toContain("to the PATH in")
      expect(again.stdout).toContain(`installed rulecast 9.9.9 at ${dir}/rulecast\n`)
      expect(count(read(path.join(home, ".profile")), `. "${dir}/env"`)).toBe(1)
    }
  })

  test("a directory on the PATH with a trailing slash is on the PATH", async () => {
    const dir = path.join(scratch("own"), "bin")
    const run = await install({ pathFirst: `${dir}/`, env: { RULECAST_INSTALL_DIR: dir, SHELL: "/bin/zsh" } })
    expect(run.status, run.stderr).toBe(0)
    expect(readdirSync(run.home)).toEqual([])
    // Nor does sourcing its env file add it again.
    const sourced = spawnSync("/bin/sh", ["-c", `. "${dir}/env"; printf %s "$PATH"`], {
      env: { PATH: `${dir}/:/usr/bin:/bin` },
      encoding: "utf8",
    })
    expect(sourced.stdout).toBe(`${dir}/:/usr/bin:/bin`)
  })

  test("its env file finds the directory on the PATH however many trailing slashes it has, in any sh", async () => {
    const home = path.join(scratch("odd"), "my home")
    mkdirSync(home)
    const run = await install({ home })
    expect(run.status, run.stderr).toBe(0)
    const dir = bin(home)
    const env = path.join(dir, "env")
    const shells = ["/bin/sh", "/bin/bash", "/bin/zsh", "dash"]
      .map((shell) => spawnSync("/bin/sh", ["-c", `command -v ${shell}`], { encoding: "utf8" }).stdout.trim())
      .filter((shell) => shell !== "")
    for (const shell of shells) {
      for (const [before, after] of [
        [`${dir}//:/usr/bin:/bin`, `${dir}//:/usr/bin:/bin`],
        [`/usr/bin:${dir}/:/bin`, `/usr/bin:${dir}/:/bin`],
        ["/usr/bin:/bin", `${dir}:/usr/bin:/bin`],
      ]) {
        const sourced = spawnSync(shell, ["-c", `. "$1"; . "$1"; printf %s "$PATH"`, "sh", env], {
          env: { HOME: home, PATH: before },
          encoding: "utf8",
        })
        expect(sourced.stdout, `${shell}: ${before}`).toBe(after)
      }
    }
  })

  test("installDir drops trailing slashes as the script does", async () => {
    for (const env of <Record<string, string>[]>[
      { RULECAST_INSTALL_DIR: `${path.join(scratch("own"), "bin")}//` },
      { RULECAST_INSTALL_DIR: "", XDG_BIN_HOME: `${scratch("xdg")}/` },
    ]) {
      const home = scratch("home")
      const run = await install({ home, env })
      expect(run.status, run.stderr).toBe(0)
      expect(run.stdout).toContain(`installed rulecast 9.9.9 at ${installDir({ HOME: home, ...env })}/rulecast\n`)
    }
  })

  test("GITHUB_PATH set: appends the dir there once", async () => {
    const githubPath = path.join(scratch("gh"), "path")
    const home = scratch("home")
    expect((await install({ home, env: { GITHUB_PATH: githubPath } })).status).toBe(0)
    expect((await install({ home, env: { GITHUB_PATH: githubPath } })).status).toBe(0)
    expect(read(githubPath)).toBe(`${bin(home)}\n`)
  })

  test("sourcing <dir>/env puts the dir on the PATH once, also when sourced twice", async () => {
    const run = await install()
    const env = path.join(bin(run.home), "env")
    const result = spawnSync("/bin/sh", ["-c", `. "${env}"; . "${env}"; printf %s "$PATH"`], {
      env: { HOME: run.home, PATH: "/usr/bin:/bin" },
      encoding: "utf8",
    })
    expect(result.stdout).toBe(`${bin(run.home)}:/usr/bin:/bin`)
  })

  // Six installs in a row: slow on a loaded machine, so a longer timeout.
  test("maps every shipped target, and only those", async () => {
    const unames: [string, string | null][] = [
      ["Linux x86_64", "linux-x64"],
      ["Linux aarch64", "linux-arm64"],
      ["Linux arm64", "linux-arm64"],
      ["Darwin arm64", "darwin-arm64"],
      ["Darwin x86_64", "darwin-x64"],
      ["MINGW64_NT-10.0 x86_64", null],
    ]
    const named = new Set<string>()
    for (const [uname, target] of unames) {
      // The fake release only has this machine's asset: any other download fails, naming its URL.
      const run = await install({ uname })
      expect(run.status).toBe(target === hostTarget() ? 0 : 1)
      if (target === null) {
        expect(run.stderr).toContain(`no standalone binary for ${uname}`)
        continue
      }
      if (target !== hostTarget()) expect(run.stderr).toContain(`/rulecast-${target};`)
      named.add(target)
    }
    expect([...named].sort()).toEqual([...BINARY_TARGETS].sort())
  }, 120_000)

  test("an unknown platform exits 1 naming it, writing nothing", async () => {
    const run = await install({ uname: "FreeBSD amd64" })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("no standalone binary for FreeBSD amd64")
    expect(readdirSync(run.home)).toEqual([])
  })

  test("no curl, or neither shasum nor sha256sum: exits 1 naming what is missing, writing nothing", async () => {
    const noCurl = await install({ omit: ["curl"] })
    expect(noCurl.status).toBe(1)
    expect(noCurl.stderr).toContain("curl is needed")
    expect(readdirSync(noCurl.home)).toEqual([])
    const noSha = await install({ omit: SHA_TOOLS })
    expect(noSha.status).toBe(1)
    expect(noSha.stderr).toContain("shasum or sha256sum is needed")
    expect(readdirSync(noSha.home)).toEqual([])
  })

  test("is POSIX sh: parses, and installs under dash when there is one", async () => {
    expect(spawnSync("/bin/sh", ["-n", SCRIPT]).status).toBe(0)
    const dash = spawnSync("/bin/sh", ["-c", "command -v dash"], { encoding: "utf8" }).stdout.trim()
    if (dash) expect((await install({ shell: dash })).status).toBe(0)
  })
})

describe("install.sh, asking", () => {
  test("shows what it will do, and Enter proceeds", async () => {
    const run = await install({ answers: "\n" })
    expect(run.status, run.stderr).toBe(0)
    // install.sh's VERSION line is synced from package.json, as version.ts is (pnpm sync-version).
    expect(run.stdout).toContain(`rulecast ${VERSION} will be installed:`)
    expect(run.stdout).toContain("  binary   ~/.local/bin/rulecast\n")
    expect(run.stdout).toContain("  PATH     add ~/.local/bin in ~/.profile\n")
    expect(run.stdout).toContain("1) Proceed (default)\n2) Customize\n3) Cancel\n")
    expect(existsSync(path.join(bin(run.home), "rulecast"))).toBe(true)
  })

  test("Cancel installs nothing, and so does a terminal that closes", async () => {
    for (const answers of ["3\n", ""]) {
      const run = await install({ answers })
      expect(run.status).toBe(1)
      expect(run.stdout).toContain("cancelled; nothing was installed")
      expect(readdirSync(run.home)).toEqual([])
    }
  })

  test("Customize asks the directory and the PATH, then shows the plan again", async () => {
    const dir = scratch("custom")
    const run = await install({ answers: `2\n${dir}\nn\n1\n` })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain("Install rulecast where? [~/.local/bin]: ")
    expect(run.stdout).toContain("in your shell startup files? [Y/n]: ")
    expect(run.stdout).toContain(`  binary   ${dir}/rulecast\n`)
    expect(run.stdout).toContain("  PATH     no startup file changed; you add")
    expect(existsSync(path.join(dir, "rulecast"))).toBe(true)
    expect(readdirSync(run.home)).toEqual([])
  })

  test("Customize asks again for a directory it can't use, and takes ~", async () => {
    const run = await install({ answers: "2\nrelative/bin\n~/tools\n\n\n" })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain("must be an absolute path, not relative/bin")
    expect(existsSync(path.join(run.home, "tools", "rulecast"))).toBe(true)
    expect(count(read(path.join(run.home, ".profile")), '. "$HOME/tools/env"')).toBe(1)
  })

  test("an answer that is not 1, 2 or 3 is asked again", async () => {
    const run = await install({ answers: "4\n1\n" })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain("answer 1, 2 or 3")
  })

  test("-y, --yes and RULECAST_YES=1 ask nothing, even with a terminal", async () => {
    for (const options of [{ args: ["-y"] }, { args: ["--yes"] }, { env: { RULECAST_YES: "1" } }]) {
      const run = await install({ answers: "3\n", ...options })
      expect(run.status, JSON.stringify(options)).toBe(0)
      expect(run.stdout).not.toContain("1) Proceed")
      expect(run.stdout).not.toContain("no terminal")
    }
  })

  test("with no terminal it installs the defaults and says so", async () => {
    const run = await install()
    expect(run.status).toBe(0)
    expect(run.stdout).toContain("no terminal to ask through: installing with the defaults (--help lists the options)")
  })
})

describe("install.sh options", () => {
  test("--install-dir DIR and --install-dir=DIR", async () => {
    const a = scratch("a")
    const b = scratch("b")
    expect((await install({ args: ["-y", "--install-dir", a] })).status).toBe(0)
    expect((await install({ args: ["-y", `--install-dir=${b}/`] })).status).toBe(0)
    expect(existsSync(path.join(a, "rulecast"))).toBe(true)
    expect(existsSync(path.join(b, "rulecast"))).toBe(true)
  })

  test("--no-modify-path changes no startup file", async () => {
    const run = await install({ args: ["--no-modify-path"] })
    expect(run.status).toBe(0)
    expect(readdirSync(run.home)).toEqual([".local"])
  })

  test("--help prints the options and does nothing else, curl or not", async () => {
    const run = await install({ args: ["--help"], omit: ["curl"] })
    expect(run.status).toBe(0)
    for (const option of ["-y, --yes", "--install-dir DIR", "--no-modify-path", "-h, --help", "sh -s -- [options]"]) {
      expect(run.stdout).toContain(option)
    }
    expect(readdirSync(run.home)).toEqual([])
  })

  test("an unknown option, or --install-dir with no directory, exits 1", async () => {
    expect(await install({ args: ["--force"] })).toMatchObject({ status: 1 })
    expect((await install({ args: ["--force"] })).stderr).toContain("unknown option --force")
    expect((await install({ args: ["--install-dir"] })).stderr).toContain("--install-dir needs a directory")
  })
})
