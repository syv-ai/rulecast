import { existsSync } from "node:fs"
import path from "node:path"

import { compile, compileManifest, type Diagnostic, diagnosticText } from "../core/compile/project"
import type { CompiledRule } from "../core/compile/rule"
import { CONFIG_FILE, type Loaded, MANIFEST_FILE, readYamlFile } from "../core/config/load"
import type { DetectorRegistry } from "../core/detection/registry"
import { cacheHome } from "../core/home"
import { fetchingRepos } from "../core/repos/provider"
import type { CliIo } from "./main"
import { UsageError } from "./usage"

type Validated = { rules: CompiledRule[]; diagnostics: Diagnostic[] }

type Kind = "config" | "manifest"

/** doctor puts the level in its own column; validate prefixes it. */
function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${diagnostic.level === "warning" ? "warning: " : ""}${diagnosticText(diagnostic)}`
}

/**
 * What a file is: by its name when it has one of the two, otherwise by what it holds. A manifest
 * is a list of rules and a config is a mapping with `repos:`, so a draft in `scratch/bad.yaml`
 * validates as what it is rather than being refused for its name.
 */
function kindOf(full: string, data: Loaded<unknown>): Kind | null {
  const name = path.basename(full)
  if (name === CONFIG_FILE) return "config"
  if (name === MANIFEST_FILE) return "manifest"
  if (!data.ok) return null
  if (Array.isArray(data.value)) return "manifest"
  if (typeof data.value === "object" && data.value !== null && "repos" in data.value) return "config"
  return null
}

/** Validates a config or a manifest, named or found at the root. */
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

  const read = await Promise.all(
    targets.map(async (target) => {
      const data = await readYamlFile(target.full)
      // A .yaml file that does not parse has no content to tell apart; reading it as a manifest
      // reports the YAML error the way a manifest's own is reported.
      const unparsedYaml = !data.ok && /\.ya?ml$/.test(target.full)
      const kind = kindOf(target.full, data) ?? (unparsedYaml ? "manifest" : null)
      if (kind === null) {
        throw new UsageError(`${target.shown}: neither a config (repos:) nor a manifest (a list of rules)`)
      }
      return { ...target, data, kind }
    }),
  )

  let failed = false
  for (const { shown, full, data, kind } of read) {
    const dir = path.dirname(full)
    const result: Validated =
      kind === "config"
        ? await compile({
            root: dir,
            registry,
            repos: fetchingRepos(cacheHome(io.env)),
            configData: data.ok ? data.value : undefined,
          })
        : await compileManifest(dir, registry, full)
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
