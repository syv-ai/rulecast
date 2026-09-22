import { expect, test } from "vitest"

import { runCli } from "../helpers/cli"
import { createProject } from "../helpers/project"

const USAGE = `usage:
  rulecast init [--rules id,id | --no-rules] [--agent <name>]... [--scope shared|personal] [--yes]
  rulecast install [--agent <name>]... [--scope shared|personal]
  rulecast uninstall [--agent <name>]...
  rulecast run [RULE_ID] [--all-files | --files F...] [--from-ref A [--to-ref B]] [--format terminal|agent|json|sarif] [--session <id>] [--no-llm]
  rulecast autoupdate [--freeze] [--repo URL]...
  rulecast try-repo <path|url> [RULE_ID] [--ref REV] [run flags]
  rulecast validate [file...]
  rulecast clean [--project]
  rulecast hook <adapter>
  rulecast warm [--detector <kind>]...
  rulecast doctor
`

test("help prints every command", async () => {
  const cwd = await createProject({})
  expect(await runCli(cwd, ["help"])).toMatchObject({ code: 0, stdout: USAGE })
})

test("no command prints usage and exits 2", async () => {
  const cwd = await createProject({})
  expect(await runCli(cwd, [])).toMatchObject({ code: 2, stdout: USAGE })
})

test("check is gone", async () => {
  const cwd = await createProject({})
  const result = await runCli(cwd, ["check"])
  expect(result.code).toBe(2)
  expect(result.stderr).toContain('unknown command "check"')
})
