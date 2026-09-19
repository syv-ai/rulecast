import { compile, type Diagnostic } from "../core/compile/project"
import type { DetectorRegistry } from "../core/detection/registry"
import { cacheHome } from "../core/home"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"

const line = (diagnostic: Diagnostic) =>
  `${diagnostic.level === "warning" ? "warning: " : ""}${diagnostic.source}${diagnostic.rule ? ` (${diagnostic.rule})` : ""}: ${diagnostic.message}\n`

export async function validateCommand(root: string, registry: DetectorRegistry, io: CliIo): Promise<number> {
  const project = await compile({ root, registry, repos: fetchingRepos(cacheHome(io.env)) })
  for (const diagnostic of project.diagnostics) io.stdout(line(diagnostic))
  if (project.diagnostics.some((diagnostic) => diagnostic.level === "error")) return 2
  io.stdout(`rulecast: ${project.rules.length} ${project.rules.length === 1 ? "rule" : "rules"} valid\n`)
  return 0
}
