import { createRegistry } from "../../src/core/detection/registry"
import { builtinDetectors } from "../../src/detectors"
import { createRepo } from "./git"

export const registry = createRegistry([...builtinDetectors])

export const backendConventions = [
  "# Backend",
  "## Services",
  "Business logic lives in services.",
  "## Errors",
  "Services raise domain exceptions.",
  "",
].join("\n")

export const fixtureFiles: Record<string, string> = {
  ".rulecast/rules/no-httpexception.yml": [
    "id: backend/no-httpexception",
    "files: app/services/**/*.py",
    "detect:",
    "  regex: { pattern: 'raise HTTPException\\((?<args>[^)]*)\\)' }",
    "message: '{{file}}:{{line}} raises HTTPException({{args}}). Raise a domain exception.'",
    "context: ['@conventions/backend.md#errors']",
    "",
  ].join("\n"),
  ".rulecast/rules/services-touch.yml": [
    "id: backend/services",
    "files: app/services/**/*.py",
    "on: [touch]",
    "context: ['@conventions/backend.md#services']",
    "",
  ].join("\n"),
  ".rulecast/rules/generated.yml": [
    "id: frontend/no-generated-edits",
    "files: src/client/**",
    "severity: warning",
    "detect: { path: {} }",
    "message: '{{file}} is generated. Regenerate it instead of editing.'",
    "",
  ].join("\n"),
  "conventions/backend.md": backendConventions,
  "app/services/users.py": "def get():\n    raise HTTPException(404)\n",
  "src/client/api.ts": "export const api = 1\n",
}

/** A committed git repository containing the fixture project. */
export function createFixture(): Promise<string> {
  return createRepo(fixtureFiles)
}
