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
 * else `rulecast` on the PATH, else install.sh's in its directory.
 */

/** `<version>-<platform>-<arch>`: what a binary or its native files are built for. */
export function platformKey(version: string, platform: string = process.platform, arch: string = process.arch): string {
  return `${version}-${platform}-${arch}`
}

/** Where this version's standalone binary unpacks its native files (detectors/ast-grep/embedded.ts). */
export function nativeDir(home: string, version: string = VERSION): string {
  return path.join(home, "native", platformKey(version))
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
 * else $HOME/.local/bin, empty values counting as unset, and without trailing slashes, as the script
 * trims them. test/install-script.test.ts holds the two to the same answer.
 */
export function installDir(env: Env): string {
  const dir = env.RULECAST_INSTALL_DIR || env.XDG_BIN_HOME || path.join(env.HOME || homedir(), ".local", "bin")
  return dir.replace(/(?<=.)\/+$/, "")
}

/**
 * install.sh's rulecast as the hook script and the git hooks name it: installDir's rule in shell.
 * Trailing slashes are left in: `/x/y//rulecast` is the same file.
 * The hooks' last resort, after the PATH: an agent started from the Dock or an IDE may run its
 * hooks with a PATH that never read the shell's startup files, where install.sh put the directory.
 * No single quotes, so it can go inside `sh -c '…'`.
 */
// biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a template.
export const INSTALLED_SH = '"${RULECAST_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}/rulecast"'

/**
 * The git hooks' command: the project's own rulecast, else the PATH's, else install.sh's in its
 * directory, the order the agent hooks use. With none that can run, it warns and exits 0. Git hooks run from the repository's root. The PATH's is
 * run rather than exec'd so that one the shell cannot run (126 or 127: a binary for another
 * machine, a shim with nothing behind it) counts as none and the lookup goes on, as in the hook
 * script; it has read no input when it could not run.
 */
export function gitHookCommand(args: string): string {
  return (
    `sh -c '[ -x ./node_modules/.bin/rulecast ] && exec ./node_modules/.bin/rulecast ${args}; ` +
    `if command -v rulecast >/dev/null 2>&1; then rulecast ${args}; status=$?; ` +
    `[ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; ` +
    `installed=${INSTALLED_SH}; if [ -x "$installed" ]; then "$installed" ${args}; status=$?; ` +
    `[ "$status" -ne 126 ] && [ "$status" -ne 127 ] && exit "$status"; fi; ` +
    `echo "${GIT_HOOK_MISSING}" >&2; exit 0' --`
  )
}

/**
 * What the git hook says when it finds no rulecast to run, before it lets the commit or push
 * through: a teammate who has not installed rulecast is told, not stopped (#84). The agent hooks
 * skip the same way. `rulecast doctor --ci` is where a missing rulecast fails.
 */
// No ": " in it: the command sits unquoted in YAML (.pre-commit-hooks.yaml, the lefthook snippet).
export const GIT_HOOK_MISSING = `rulecast is not installed, so this hook checked nothing. To install it, run ${INSTALL_COMMAND}`

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
