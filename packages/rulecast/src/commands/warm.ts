import { parseArgs } from "node:util"

import { compile } from "../core/compile/compile"
import type { DetectorRegistry } from "../core/detection/registry"
import { warmDetectors } from "../core/detection/warm"
import { debugLogger, ensureStateDir } from "../core/state-dir"
import type { CliIo } from "./main"
import { hasProject } from "./project"

/** Warm-ups run detached and nobody waits for them; this only bounds a stuck one. */
const WARM_TIMEOUT_MS = 5 * 60_000

export async function warmCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const { values } = parseArgs({ args, options: { detector: { type: "string", multiple: true } } })
  if (!hasProject(root)) throw new Error(`no .rulecast directory in ${root} or its parents (run rulecast init)`)
  ensureStateDir(root)
  const log = debugLogger(root)
  const result = await warmDetectors({
    root,
    project: await compile(root, registry),
    registry,
    kinds: values.detector ?? null,
    timeoutMs: WARM_TIMEOUT_MS,
  })
  if (result.warmed.length > 0) io.stdout(`rulecast: warmed ${result.warmed.join(", ")}\n`)
  if (result.skipped.length > 0) io.stdout(`rulecast: already warming ${result.skipped.join(", ")}\n`)
  for (const error of result.errors) {
    log(`warm ${error.kind} failed: ${error.message}`)
    io.stderr(`rulecast: warm ${error.kind} failed: ${error.message}\n`)
  }
  if (result.warmed.length + result.skipped.length + result.errors.length === 0) {
    io.stdout("rulecast: nothing to warm\n")
  }
  return result.errors.length > 0 ? 2 : 0
}
