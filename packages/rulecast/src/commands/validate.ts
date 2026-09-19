import { compile } from "../core/compile/compile"
import type { DetectorRegistry } from "../core/detection/registry"
import type { CliIo } from "./main"

export async function validateCommand(root: string, registry: DetectorRegistry, io: CliIo): Promise<number> {
  const project = await compile(root, registry)
  if (project.diagnostics.length > 0) {
    for (const diagnostic of project.diagnostics) {
      io.stdout(`${diagnostic.source}${diagnostic.rule ? ` (${diagnostic.rule})` : ""}: ${diagnostic.message}\n`)
    }
    return 2
  }
  io.stdout(`rulecast: ${project.rules.length} ${project.rules.length === 1 ? "rule" : "rules"} valid\n`)
  return 0
}
