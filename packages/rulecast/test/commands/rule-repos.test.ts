import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { stringify } from "yaml"

import { repoDir, repoLabel } from "../../src/core/repos/layout"
import { runCli } from "../helpers/cli"
import { createRepo } from "../helpers/git"
import { TEST_HOME } from "../helpers/home"
import { claudeCodePayload } from "../helpers/payloads"
import { createRuleRepo } from "../helpers/rule-repo"

const USERS = "app/services/users.py"
const REV = "v1.0.0"
const VIOLATION = "def get():\n    print(1)  # TODO remove\n    return 1\n"

const PYTHON_DOC = [
  "# Python",
  "",
  "## Errors",
  "",
  "Services raise domain exceptions.",
  "",
  "## Style",
  "",
  "Keep functions short.",
  "",
].join("\n")

const MANIFEST = stringify([
  {
    id: "python/no-print",
    name: "No print calls",
    files: "\\.py$",
    types: ["python"],
    detect: { regex: { pattern: "print\\((?<args>[^)]*)\\)" } },
    message: "{{file}}:{{line}} prints {{args}}. Use the logger.",
    context: ["@docs/python.md#errors", { path: "@docs/python.md#style", mode: "read" }],
  },
  {
    id: "python/no-todo",
    name: "No TODO comments",
    files: "\\.py$",
    detect: { regex: { pattern: "TODO" } },
    message: "{{file}}:{{line}} leaves a TODO. Track it in an issue.",
    context: ["@docs/python.md#style"],
  },
])

const AGENTS = [
  "# Agents",
  "",
  "## Services",
  "",
  "Services hold business logic.",
  "",
  "## Todos",
  "",
  "Track work in issues, not TODO comments.",
  "",
].join("\n")

/** A committed project pinning the rule repo at REV, plus one local touch rule. */
async function project(): Promise<{ root: string; url: string; label: string; location: string }> {
  const url = await createRuleRepo([
    { tag: REV, files: { ".rulecast-rules.yaml": MANIFEST, "docs/python.md": PYTHON_DOC } },
  ])
  const config = stringify({
    repos: [
      {
        repo: url,
        rev: REV,
        rules: [{ id: "python/no-print" }, { id: "python/no-todo", context: ["@AGENTS.md#todos"] }],
      },
      {
        repo: "local",
        rules: [
          {
            id: "local/services",
            name: "Service conventions",
            files: "^app/services/",
            stages: ["touch"],
            context: ["@AGENTS.md#services"],
          },
        ],
      },
    ],
  })
  const root = await createRepo({
    ".rulecast-config.yaml": config,
    "AGENTS.md": AGENTS,
    [USERS]: "def get():\n    return 1\n",
  })
  return {
    root,
    url,
    label: repoLabel(url, REV),
    location: path.join(repoDir(TEST_HOME, url, REV), "docs/python.md"),
  }
}

function hook(root: string, name: string, file?: string) {
  const payload = claudeCodePayload(name, { root, file, sessionId: "s1" })
  return runCli(root, ["hook", "claude-code"], JSON.stringify(payload))
}

const additionalContext = (stdout: string): string => JSON.parse(stdout).hookSpecificOutput.additionalContext

/** What an agent must see for VIOLATION in USERS, from a hook or from run --format agent. */
function expectRepoDelivery(text: string, label: string, location: string) {
  expect(text).toContain("error python/no-print")
  expect(text).toContain(`${USERS}:2 prints 1. Use the logger.`)
  expect(text).toContain(`${USERS}:2 leaves a TODO. Track it in an issue.`)
  // Injected from the rule repo, labelled with its source.
  expect(text).toContain(`--- ${label}:docs/python.md#errors ---\n## Errors\n\nServices raise domain exceptions.`)
  // A read reference from a rule repo points at the fetched file.
  expect(text).toContain(`--- ${label}:docs/python.md#style: read ${location} before continuing ---`)
  // The override's context resolves against the project, not the rule repo.
  expect(text).toContain("--- AGENTS.md#todos ---\n## Todos\n\nTrack work in issues, not TODO comments.")
  expect(text).not.toContain(`--- ${label}:docs/python.md#style ---`)
}

describe("rule repos end to end", () => {
  test("hooks never fetch: a missing repo is a warning once per context, and local rules keep working", async () => {
    const { root, url } = await project()
    const read = await hook(root, "post-tool-use.read.complete", USERS)
    expect(read.code).toBe(0)
    const text = additionalContext(read.stdout)
    expect(text).toContain("--- AGENTS.md#services ---")
    expect(text).toContain(`${url}@${REV}: not in the cache (run rulecast install)`)
    expect(existsSync(repoDir(TEST_HOME, url, REV))).toBe(false)

    await writeFile(path.join(root, USERS), VIOLATION)
    const edit = await hook(root, "post-tool-use.edit", USERS)
    expect(edit.code).toBe(0)
    expect(edit.stdout).not.toContain("not in the cache")
    expect(edit.stdout).not.toContain("python/no-print")
  })

  test("after install, hooks deliver repo rules with labelled references", async () => {
    const { root, label, location } = await project()
    const install = await runCli(root, ["install"])
    expect(install.code).toBe(0)
    expect(install.stdout).toContain(`fetched ${label}`)

    const read = await hook(root, "post-tool-use.read.complete", USERS)
    expect(additionalContext(read.stdout)).not.toContain("not in the cache")

    await writeFile(path.join(root, USERS), VIOLATION)
    const edit = await hook(root, "post-tool-use.edit", USERS)
    expectRepoDelivery(additionalContext(edit.stdout), label, location)

    const stop = JSON.parse((await hook(root, "stop")).stdout)
    expect(stop.decision).toBe("block")
    expect(stop.reason).toContain(`${USERS}:2 prints 1. Use the logger.`)
    // Delivered at the edit, so the stop only points at it.
    expect(stop.reason).toContain(`--- ${label}:docs/python.md#errors (provided earlier in this session) ---`)
  })

  test("run fetches missing repos and reports repo rules the same way", async () => {
    const { root, url, label, location } = await project()
    await writeFile(path.join(root, USERS), VIOLATION)
    const result = await runCli(root, ["run", "--all-files", "--format", "agent"])
    expect(result.code).toBe(1)
    expectRepoDelivery(result.stdout, label, location)
    expect(existsSync(repoDir(TEST_HOME, url, REV))).toBe(true)
  })
})
