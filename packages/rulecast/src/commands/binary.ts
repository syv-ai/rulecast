import { chmod, copyFile, mkdir, readdir, readlink, realpath, rename, rm, stat, symlink } from "node:fs/promises"
import path from "node:path"

import { binaryPath, currentBinaryPath, installOneLiner, platformKey, probeRulecast } from "../core/binary-home"
import { errorMessage } from "../core/errors"
import { cacheHome } from "../core/home"
import { installLabel } from "../core/self"
import { VERSION } from "../core/version"
import { isStandaloneBinary } from "../detectors/ast-grep/embedded"
import { parserFor } from "../detectors/ast-grep/load"
import type { CliIo } from "./main"
import { UsageError } from "./usage"

/**
 * `rulecast binary install` and `rulecast binary path`. Install puts this standalone binary where
 * the agent hooks and git hooks look for it. Only the developer runs it, by hand or through the
 * one-liner in the README; nothing in a hook does.
 */
export async function binaryCommand(args: string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = args
  if (rest.length > 0) throw new UsageError(`unexpected argument "${rest[0]}"`)
  if (sub === "install") return install(io)
  if (sub === "path") return current(io)
  throw new UsageError(sub === undefined ? "binary needs install or path" : `unknown binary command "${sub}"`)
}

async function install(io: CliIo): Promise<number> {
  if (!isStandaloneBinary()) {
    io.stderr(
      `rulecast binary install is for the standalone binary; this rulecast runs on node from ${installLabel()}. ` +
        `To install the binary, run:\n\n  ${installOneLiner(VERSION)}\n`,
    )
    return 2
  }
  const home = cacheHome(io.env)
  const target = binaryPath(home, VERSION)
  const link = currentBinaryPath(home)
  const relative = path.relative(path.dirname(link), target)
  const self = await realpath(process.execPath)
  const same =
    (await readlink(link).catch(() => null)) === relative &&
    (await stat(target).catch(() => null))?.size === (await stat(self)).size
  if (same) {
    io.stdout(`rulecast: ${VERSION} is already installed at ${target}\n`)
    return 0
  }
  const partial = `${target}.${process.pid}.tmp`
  const partialLink = `${link}.${process.pid}.tmp`
  try {
    if (self !== (await realpath(target).catch(() => null))) {
      await mkdir(path.dirname(target), { recursive: true })
      await copyFile(self, partial)
      await chmod(partial, 0o755)
      await rename(partial, target)
    }
    await rm(partialLink, { force: true })
    await symlink(relative, partialLink)
    await rename(partialLink, link)
  } catch (error) {
    // A copy cut short (a full disk) must not stay behind: 65 MB, and never used.
    await rm(partial, { force: true }).catch(() => {})
    await rm(partialLink, { force: true }).catch(() => {})
    io.stderr(`rulecast: could not install into ${path.dirname(link)}: ${errorMessage(error)}\n`)
    return 2
  }
  // Other versions of the binary for this machine are no longer run by anything. Those for other
  // machines stay: a shared cache home may be another machine's install.
  const removed: string[] = []
  const suffix = platformKey("").slice(1)
  for (const entry of await readdir(path.dirname(link), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !entry.name.endsWith(`-${suffix}`)) continue
    if (entry.name === path.basename(path.dirname(target))) continue
    await rm(path.join(path.dirname(link), entry.name), { recursive: true, force: true })
    removed.push(entry.name.slice(0, -suffix.length - 1))
  }
  // Loads ast-grep's native module and the Python parser once now, through the same unpacking the
  // hooks use, so the first edit after installing does not pay for it.
  for (const language of ["typescript", "python"] as const) {
    await parserFor(language).catch((error: unknown) => {
      io.stderr(`rulecast: warning: ${language} ast-grep rules will not run: ${errorMessage(error)}\n`)
    })
  }
  io.stdout(
    `rulecast: installed ${VERSION} at ${target}; the agent hooks and git hooks run it unless the project has its own in node_modules\n`,
  )
  if (removed.length > 0) io.stdout(`rulecast: removed the binary of ${removed.join(", ")}\n`)
  return 0
}

async function current(io: CliIo): Promise<number> {
  const link = currentBinaryPath(cacheHome(io.env))
  const target = await realpath(link).catch(() => null)
  const probe = target === null ? null : await probeRulecast(target)
  if (target === null || probe === null) {
    io.stdout("none\n")
    return 1
  }
  io.stdout(`${target} ${probe.version ?? "(unknown version)"}\n`)
  return 0
}
