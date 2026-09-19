import { type CompiledProject, compile } from "../../src/core/compile/project"
import { createRegistry } from "../../src/core/detection/registry"
import { cachedRepos } from "../../src/core/repos/provider"
import { builtinDetectors } from "../../src/detectors"
import { localConfig } from "./config"
import { createRepo } from "./git"
import { TEST_HOME } from "./home"

export const registry = createRegistry([...builtinDetectors])

export const backendConventions = [
  "# Backend",
  "## Services",
  "Business logic lives in services.",
  "## Errors",
  "Services raise domain exceptions.",
  "",
].join("\n")

export const fixtureRules: Record<string, unknown>[] = [
  {
    id: "backend/no-httpexception",
    name: "No HTTPException in services",
    files: "^app/services/.*\\.py$",
    detect: { regex: { pattern: "raise HTTPException\\((?<args>[^)]*)\\)" } },
    message: "{{file}}:{{line}} raises HTTPException({{args}}). Raise a domain exception.",
    context: ["@conventions/backend.md#errors"],
  },
  {
    id: "backend/services",
    name: "Service conventions",
    files: "^app/services/.*\\.py$",
    stages: ["touch"],
    context: ["@conventions/backend.md#services"],
  },
  {
    id: "frontend/no-generated-edits",
    name: "Generated client",
    files: "^src/client/",
    severity: "warning",
    detect: { path: {} },
    message: "{{file}} is generated. Regenerate it instead of editing.",
  },
]

export const fixtureFiles: Record<string, string> = {
  ".rulecast-config.yaml": localConfig(fixtureRules),
  "conventions/backend.md": backendConventions,
  "app/services/users.py": "def get():\n    raise HTTPException(404)\n",
  "src/client/api.ts": "export const api = 1\n",
}

/** A committed git repository containing the fixture project. */
export function createFixture(): Promise<string> {
  return createRepo(fixtureFiles)
}

/** Compiles a project the way hooks do: rule repos only from the test cache. */
export function compileAt(root: string): Promise<CompiledProject> {
  return compile({ root, registry, repos: cachedRepos(TEST_HOME) })
}
