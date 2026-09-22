import { compile, type Diagnostic } from "../core/compile/project"
import { CONFIG_FILE } from "../core/config/load"
import type { DetectorRegistry } from "../core/detection/registry"
import { cacheHome, ensureProjectState } from "../core/home"
import { cachedRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"

type Level = "ok" | "warning" | "error" | "skipped"

/** A status line: a padded level, then what was checked and why. */
function line(level: Level, what: string, detail: string): string {
  return `  ${level.padEnd(7)}  ${what}${detail === "" ? "" : ` — ${detail}`}\n`
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/** validate's wording, so the two commands describe a diagnostic the same way. */
export function diagnosticText(diagnostic: Diagnostic): string {
  const rule = diagnostic.rule ? ` (${diagnostic.rule})` : ""
  return `${diagnostic.source}${rule}: ${diagnostic.message}`
}

/**
 * Compile, check the environment, report where things live, and dry-run every rule (spec §5).
 * Errors exit 2; warnings do not — an uninstalled adapter is worth saying and is not a broken
 * installation.
 */
export async function doctorCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  if (args.length > 0) throw new UsageError(`doctor takes no arguments: ${args.join(" ")}`)
  const home = cacheHome(io.env)
  io.stdout("rulecast doctor\n\n")

  if (!hasProject(root)) {
    io.stdout(`home       ${home}\n`)
    io.stderr(`rulecast: no ${CONFIG_FILE} in ${io.cwd} or its parents (run rulecast init)\n`)
    return 2
  }

  let errors = 0
  let warnings = 0
  const count = (level: Level) => {
    if (level === "error") errors++
    if (level === "warning") warnings++
  }

  const stateDir = ensureProjectState(home, root)
  io.stdout(`project    ${root}\n`)

  const project = await compile({ root, registry, repos: fetchingRepos(home) })
  const configErrors = project.diagnostics.filter((diagnostic) => diagnostic.level === "error").length
  const configWarnings = project.diagnostics.length - configErrors
  io.stdout(
    `config     ${CONFIG_FILE} — ${plural(project.rules.length, "rule")}, ` +
      `${plural(configErrors, "error")}, ${plural(configWarnings, "warning")}\n`,
  )
  for (const diagnostic of project.diagnostics) {
    count(diagnostic.level)
    io.stdout(line(diagnostic.level, diagnosticText(diagnostic), ""))
  }

  io.stdout("\ncache\n")
  io.stdout(`  home       ${home}\n`)
  io.stdout(`  project    ${stateDir}\n`)
  for (const entry of project.config.repos) {
    if (entry.repo === "local" || entry.rev === undefined) continue
    const label = repoLabel(entry.repo, entry.rev)
    const cached = cachedRepo(home, entry.repo, entry.rev) !== null
    // Not an error of its own: compile has already said so if it mattered.
    io.stdout(`  repos      ${label} — ${cached ? "cached" : "not fetched (run rulecast install)"}\n`)
  }
  io.stdout(
    `\n${errors + warnings === 0 ? "no problems found" : [plural(errors, "error"), plural(warnings, "warning")].join(", ")}\n`,
  )
  return errors > 0 ? 2 : 0
}
