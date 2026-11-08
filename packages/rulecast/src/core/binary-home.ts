import { execFile } from "node:child_process"
import path from "node:path"

import { childEnv } from "./child-env"
import { cacheHome, type Env } from "./home"
import { VERSION } from "./version"

/**
 * Where the standalone binary lives once installed, in TypeScript and as the shell fragments the
 * hooks run. `rulecast binary install` is the one thing that writes here, and only when the
 * developer runs it (directly, or through the one-liner below). No hook downloads or installs.
 *
 * Layout: `<cache home>/bin/<version>-<platform>-<arch>/rulecast`, plus
 * `<cache home>/bin/rulecast-<platform>-<arch>`, a link to the one installed last for that platform.
 * Both are keyed by platform: a cache home can be shared between machines (a mounted home
 * directory), one machine's binary does not run on another, and each machine has its own current one.
 */

/** `<version>-<platform>-<arch>`: what a binary or its native files are built for. */
export function platformKey(version: string, platform: string = process.platform, arch: string = process.arch): string {
  return `${version}-${platform}-${arch}`
}

export function binaryPath(home: string, version: string): string {
  return path.join(home, "bin", platformKey(version), "rulecast")
}

/** This machine's current link; the hooks' shell finds the same one through runInstalledBinarySh. */
export function currentBinaryPath(
  home: string,
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  return path.join(home, "bin", `rulecast-${platform}-${arch}`)
}

/** Where this version's standalone binary unpacks its native files (detectors/ast-grep/embedded.ts). */
export function nativeDir(home: string, version: string = VERSION): string {
  return path.join(home, "native", platformKey(version))
}

/**
 * Sets `H` to the home `cacheHome()` (core/home.ts) resolves: $RULECAST_HOME, else
 * $XDG_CACHE_HOME/rulecast, else $HOME/.cache/rulecast, empty values counting as unset. With all
 * three unset, `H` is empty and the hooks do not look for the installed binary (cacheHome falls
 * back to the OS's home directory, which the shell cannot see). No single quotes, so it can go
 * inside `sh -c '…'`. test/core/binary-home.test.ts runs it against cacheHome.
 */
export const CACHE_HOME_SH =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a template.
  "H=${RULECAST_HOME:-${XDG_CACHE_HOME:+$XDG_CACHE_HOME/rulecast}}; H=${H:-${HOME:+$HOME/.cache/rulecast}}"

/**
 * The cache home the hook commands look for the installed binary in, as CACHE_HOME_SH resolves it:
 * cacheHome(env), or null when RULECAST_HOME, XDG_CACHE_HOME and HOME are all unset or empty.
 */
export function hookCacheHome(env: Env): string | null {
  return env.RULECAST_HOME || env.XDG_CACHE_HOME || env.HOME ? cacheHome(env) : null
}

/**
 * Sets `T` to this machine's release target, as scripts/build-binary.ts names them, from one
 * `uname -sm`; anything else runs `otherwise`. The one mapping behind the one-liner (TARGET_SH)
 * and the hooks' choice of link (runInstalledBinarySh).
 */
function targetCase(otherwise: string): string {
  return (
    'case "$(uname -sm)" in ' +
    '"Linux x86_64") T=linux-x64;; "Linux aarch64"|"Linux arm64") T=linux-arm64;; ' +
    '"Darwin arm64") T=darwin-arm64;; "Darwin x86_64") T=darwin-x64;; ' +
    `*) ${otherwise};; esac`
  )
}

/**
 * After CACHE_HOME_SH: runs this machine's installed binary (`<home>/bin/rulecast-<target>`) with
 * `args` when there is one, and exits with its code. Only this machine's link is ever run: a shell
 * such as busybox's runs a binary it cannot execute as a script, which could end in any exit code.
 * One that still cannot run (126 or 127, such as one the OS refuses) counts as none, so the command
 * goes on to the PATH; every other code, a crash or a kill (128+N) too, is the answer. Not `exec`:
 * then a broken binary would be the end. The input is `stdin`, a shell word (the agent hook's
 * payload, read once).
 */
export function runInstalledBinarySh(args: string, stdin?: string): string {
  const bin = '"$H/bin/rulecast-$T"'
  const run = stdin === undefined ? `${bin} ${args}` : `printf '%s' ${stdin} | ${bin} ${args}`
  return (
    `T=; [ -n "$H" ] && ${targetCase("T=")}; ` +
    `if [ -n "$T" ] && [ -x ${bin} ]; then ${run}; S=$?; ${exitUnlessUnrunnable("S")}; fi`
  )
}

/** Exits with `$<name>` unless it is 126 or 127, the shell's "could not run it". */
export function exitUnlessUnrunnable(name: string): string {
  return `[ "$${name}" -ne 126 ] && [ "$${name}" -ne 127 ] && exit "$${name}"`
}

export const RELEASE_REPO = "syv-ai/rulecast"

/** A release asset: `rulecast-<target>` or its `.sha256`, for a bare `vX.Y.Z` tag. */
export function releaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${asset}`
}

/** Sets `T` to the release target for this machine, as scripts/build-binary.ts names them, or exits 1. */
export const TARGET_SH = targetCase('echo "rulecast: no standalone binary for $(uname -sm)" >&2; exit 1')

/**
 * The command a developer runs to install the binary of `version`. It downloads the release asset
 * for this machine and its `.sha256` into a new temp directory, checks one against the other, and
 * only then runs the download's own `binary install`. Any failing step stops it, and the temp
 * directory is removed either way. The checksum catches a truncated or corrupted download; it is
 * the same trust as the binary itself (GitHub Releases over TLS).
 */
export function installOneLiner(version: string): string {
  const asset = releaseAssetUrl(version, "rulecast-$T")
  const check =
    "if command -v shasum >/dev/null 2>&1; then shasum -a 256 -c rulecast-$T.sha256; else sha256sum -c rulecast-$T.sha256; fi"
  return (
    `sh -c '${TARGET_SH}; D=$(mktemp -d) && cd "$D" && ` +
    `curl --proto =https -fsSLO ${asset} && curl --proto =https -fsSLO ${asset}.sha256 && ${check} && ` +
    `chmod +x rulecast-$T && ./rulecast-$T binary install; R=$?; cd / && rm -rf "$D"; exit $R'`
  )
}

/**
 * The git hooks' command: the project's own rulecast, else the installed binary, else the PATH,
 * the order the agent hooks use. Git hooks run from the repository's root.
 */
export function gitHookCommand(args: string): string {
  return (
    `sh -c '${CACHE_HOME_SH}; [ -x ./node_modules/.bin/rulecast ] && exec ./node_modules/.bin/rulecast ${args}; ` +
    `${runInstalledBinarySh(args)}; exec rulecast ${args}' --`
  )
}

/**
 * Runs `<file> --version`. Null when it cannot run at all (missing, not executable, a binary for
 * another machine, or the shell's 126 and 127, as a version-manager shim with nothing behind it
 * gives); otherwise its version, or null in `version` when it printed something else.
 */
export function probeRulecast(file: string, signal?: AbortSignal): Promise<{ version: string | null } | null> {
  return new Promise((resolve) => {
    try {
      execFile(file, ["--version"], { timeout: 15_000, signal, encoding: "utf8", env: childEnv() }, (error, stdout) => {
        const code = (error as { code?: unknown } | null)?.code
        if (error && (typeof code === "string" || code === 126 || code === 127)) return resolve(null)
        const version = /^\d+\.\d+\.\d+$/.test(stdout.trim()) ? stdout.trim() : null
        resolve({ version: error ? null : version })
      })
    } catch {
      // A file the OS cannot execute (ENOEXEC) can throw here, before any callback.
      resolve(null)
    }
  })
}
