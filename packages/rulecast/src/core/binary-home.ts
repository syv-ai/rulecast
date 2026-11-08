import { execFile } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"

import { childEnv } from "./child-env"
import type { Env } from "./home"
import { VERSION } from "./version"

/**
 * The standalone binary: how it is installed, and how the hooks find a rulecast. install.sh (at the
 * repository root) installs it as `<install dir>/rulecast`, on the PATH, and only when the developer
 * runs it. No hook downloads or installs. The hooks run the project's `node_modules/.bin/rulecast`,
 * else `rulecast` on the PATH.
 */

/** `<version>-<platform>-<arch>`: what a binary or its native files are built for. */
export function platformKey(version: string, platform: string = process.platform, arch: string = process.arch): string {
  return `${version}-${platform}-${arch}`
}

/** Where this version's standalone binary unpacks its native files (detectors/ast-grep/embedded.ts). */
export function nativeDir(home: string, version: string = VERSION): string {
  return path.join(home, "native", platformKey(version))
}

/** Exits with `$<name>` unless it is 126 or 127, the shell's "could not run it". */
export function exitUnlessUnrunnable(name: string): string {
  return `[ "$${name}" -ne 126 ] && [ "$${name}" -ne 127 ] && exit "$${name}"`
}

/**
 * The command that installs the latest release's binary: install.sh at the repository root, served
 * by the docs site. It verifies the download and puts `rulecast` on the PATH.
 */
export const INSTALL_COMMAND = "curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh"

/** The same for one release: the install.sh attached to it installs that version. */
export function pinnedInstallCommand(version: string): string {
  return `curl -LsSf https://github.com/syv-ai/rulecast/releases/download/v${version}/install.sh | sh`
}

/**
 * The directory install.sh installs into, as it decides: $RULECAST_INSTALL_DIR, else $XDG_BIN_HOME,
 * else $HOME/.local/bin, empty values counting as unset. test/install-script.test.ts holds the two
 * to the same answer.
 */
export function installDir(env: Env): string {
  return env.RULECAST_INSTALL_DIR || env.XDG_BIN_HOME || path.join(env.HOME || homedir(), ".local", "bin")
}

/**
 * The git hooks' command: the project's own rulecast, else the PATH's, the order the agent hooks
 * use. Git hooks run from the repository's root.
 */
export function gitHookCommand(args: string): string {
  return `sh -c '[ -x ./node_modules/.bin/rulecast ] && exec ./node_modules/.bin/rulecast ${args}; exec rulecast ${args}' --`
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
