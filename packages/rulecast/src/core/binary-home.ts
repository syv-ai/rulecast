import { execFile } from "node:child_process"
import path from "node:path"

/**
 * Where the standalone binary lives once installed, in TypeScript and as the shell fragments the
 * hooks run. `rulecast binary install` is the one thing that writes here, and only when the
 * developer runs it (directly, or through the one-liner below). No hook downloads or installs.
 *
 * Layout: `<cache home>/bin/<version>/rulecast`, plus `<cache home>/bin/rulecast`, a link to the
 * version installed last.
 */

export function binaryPath(home: string, version: string): string {
  return path.join(home, "bin", version, "rulecast")
}

export function currentBinaryPath(home: string): string {
  return path.join(home, "bin", "rulecast")
}

/**
 * Sets `H` to the home `cacheHome()` (core/home.ts) resolves: $RULECAST_HOME, else
 * $XDG_CACHE_HOME/rulecast, else ~/.cache/rulecast, empty values counting as unset. No single
 * quotes, so it can go inside `sh -c '…'`. test/core/binary-home.test.ts runs it against cacheHome.
 */
export const CACHE_HOME_SH =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a template.
  "H=${RULECAST_HOME:-${XDG_CACHE_HOME:+$XDG_CACHE_HOME/rulecast}}; H=${H:-$HOME/.cache/rulecast}"

/** The installed binary's current link, after CACHE_HOME_SH. */
export const CURRENT_BINARY_SH = '"$H/bin/rulecast"'

export const RELEASE_REPO = "syv-ai/rulecast"

/** A release asset: `rulecast-<target>` or its `.sha256`, for a bare `vX.Y.Z` tag. */
export function releaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${asset}`
}

/** Sets `T` to the release target for this machine, as scripts/build-binary.ts names them, or exits 1. */
export const TARGET_SH =
  'case "$(uname -s)-$(uname -m)" in ' +
  "Linux-x86_64) T=linux-x64;; Linux-aarch64|Linux-arm64) T=linux-arm64;; " +
  "Darwin-arm64) T=darwin-arm64;; Darwin-x86_64) T=darwin-x64;; " +
  '*) echo "rulecast: no standalone binary for $(uname -s) $(uname -m)" >&2; exit 1;; esac'

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
    `curl -fsSLO ${asset} && curl -fsSLO ${asset}.sha256 && ${check} && ` +
    `chmod +x rulecast-$T && ./rulecast-$T binary install; R=$?; cd / && rm -rf "$D"; exit $R'`
  )
}

/**
 * The git hooks' command: the project's own rulecast, else the installed binary, else the PATH,
 * the order the agent hooks use. Git hooks run from the repository's root.
 */
export function gitHookCommand(args: string): string {
  return (
    `sh -c '${CACHE_HOME_SH}; R=./node_modules/.bin/rulecast; [ -x "$R" ] || R=${CURRENT_BINARY_SH}; ` +
    `[ -x "$R" ] || R=rulecast; exec "$R" ${args}' --`
  )
}

/**
 * Runs `<file> --version`. Null when it cannot run at all (missing, not executable, or the shell's
 * 126 and 127, as a version-manager shim with nothing behind it gives); otherwise its version, or
 * null in `version` when it printed something else.
 */
export function probeRulecast(file: string, signal?: AbortSignal): Promise<{ version: string | null } | null> {
  return new Promise((resolve) => {
    execFile(file, ["--version"], { timeout: 5000, signal, encoding: "utf8" }, (error, stdout) => {
      const code = (error as { code?: unknown } | null)?.code
      if (error && (typeof code === "string" || code === 126 || code === 127)) return resolve(null)
      const version = /^\d+\.\d+\.\d+$/.test(stdout.trim()) ? stdout.trim() : null
      resolve({ version: error ? null : version })
    })
  })
}
