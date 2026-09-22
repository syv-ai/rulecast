import { existsSync } from "node:fs"
import path from "node:path"

import { compile, compileManifest, type Diagnostic, diagnosticText } from "../core/compile/project"
import type { CompiledRule } from "../core/compile/rule"
import { CONFIG_FILE, MANIFEST_FILE } from "../core/config/load"
import type { DetectorRegistry } from "../core/detection/registry"
import { cacheHome } from "../core/home"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { UsageError } from "./usage"

type Validated = { rules: CompiledRule[]; diagnostics: Diagnostic[] }

/** doctor puts the level in its own column; validate prefixes it. */
function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${diagnostic.level === "warning" ? "warning: " : ""}${diagnosticText(diagnostic)}`
}

/** Validates `.rulecast-config.yaml` as a config and `.rulecast-rules.yaml` as a manifest, by file name. */
export async function validateCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const targets =
    args.length > 0
      ? args.map((file) => ({ shown: file, full: path.resolve(io.cwd, file) }))
      : [CONFIG_FILE, MANIFEST_FILE]
          .filter((name) => existsSync(path.join(root, name)))
          .map((name) => ({ shown: name, full: path.join(root, name) }))
  if (targets.length === 0) throw new Error(`nothing to validate: no ${CONFIG_FILE} or ${MANIFEST_FILE}`)
  for (const { shown, full } of targets) {
    const name = path.basename(full)
    if (name !== CONFIG_FILE && name !== MANIFEST_FILE) {
      throw new UsageError(`${shown}: not a ${CONFIG_FILE} or ${MANIFEST_FILE}`)
    }
  }

  let failed = false
  for (const { shown, full } of targets) {
    const dir = path.dirname(full)
    const result: Validated =
      path.basename(full) === CONFIG_FILE
        ? await compile({ root: dir, registry, repos: fetchingRepos(cacheHome(io.env)) })
        : await compileManifest(dir, registry)
    for (const diagnostic of result.diagnostics) io.stdout(`${shown}: ${formatDiagnostic(diagnostic)}\n`)
    if (result.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
      failed = true
      continue
    }
    const count = result.rules.length
    io.stdout(`${shown}: ${count} ${count === 1 ? "rule" : "rules"} valid\n`)
  }
  return failed ? 2 : 0
}
