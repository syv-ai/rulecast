import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createRuleRepo } from "./rule-repo"

/** The repository root: packages/rulecast/test/helpers is four levels down. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))

/** The rulecast repository as a catalog: its generated manifest and every rule package's files. */
export function catalogFiles(): Record<string, string> {
  const files: Record<string, string> = {
    ".rulecast-rules.yaml": readFileSync(path.join(REPO_ROOT, ".rulecast-rules.yaml"), "utf8"),
  }
  const packages = path.join(REPO_ROOT, "packages")
  for (const name of readdirSync(packages)) {
    if (!name.startsWith("rules-")) continue
    for (const entry of readdirSync(path.join(packages, name), { recursive: true, encoding: "utf8" })) {
      const file = path.join(packages, name, entry)
      if (!statSync(file).isFile()) continue
      files[["packages", name, ...entry.split(path.sep)].join("/")] = readFileSync(file, "utf8")
    }
  }
  return files
}

/** A bare "rulecast repository" holding this repository's catalog, tagged v0.2.0. */
export function createCatalogRepo(): Promise<string> {
  return createRuleRepo([{ tag: "v0.2.0", files: catalogFiles() }])
}
