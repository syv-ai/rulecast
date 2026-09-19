import { parseArgs } from "node:util"

import { compile } from "../core/compile/project"
import type { DetectorRegistry } from "../core/detection/registry"
import { warmDetectors } from "../core/detection/warm"
import { cacheHome, debugLogger, ensureProjectState } from "../core/home"
import { cachedRepos } from "../core/repos/provider"
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
  if (!hasProject(root)) throw new Error(`no .rulecast-config.yaml in ${root} or its parents (run rulecast init)`)
  const home = cacheHome(io.env)
  const stateDir = ensureProjectState(home, root)
  const log = debugLogger(stateDir)
  const result = await warmDetectors({
    root,
    stateDir,
    // Hooks start warm-ups detached, so like hooks it never fetches rule repos.
    project: await compile({ root, registry, repos: cachedRepos(home) }),
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
