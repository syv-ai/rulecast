import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

import { COMMANDS, commandHelp, usage } from "../../src/commands/help"
import { VERSION } from "../../src/core/version"
import { runCli } from "../helpers/cli"
import { createProject } from "../helpers/project"

test("help prints every command with what it is for", async () => {
  const cwd = await createProject({})
  const result = await runCli(cwd, ["help"])
  expect(result).toMatchObject({ code: 0, stdout: usage() })
  for (const command of COMMANDS) expect(result.stdout).toContain(`  ${command.name}`)
  for (const command of COMMANDS) expect(result.stdout).toContain(command.summary)
})

test("no command prints usage and exits 2", async () => {
  const cwd = await createProject({})
  expect(await runCli(cwd, [])).toMatchObject({ code: 2, stdout: usage() })
})

test("--version and -v print the version", async () => {
  const cwd = await createProject({})
  for (const flag of ["--version", "-v", "version"]) {
    expect(await runCli(cwd, [flag])).toMatchObject({ code: 0, stdout: `${VERSION}\n` })
  }
})

test("<command> --help and help <command> print that command's synopsis and flags", async () => {
  const cwd = await createProject({})
  for (const argv of [
    ["run", "--help"],
    ["run", "-h"],
    ["help", "run"],
  ]) {
    const result = await runCli(cwd, argv)
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(commandHelp("run"))
    expect(result.stdout).toContain("--from-ref A")
  }
  // The flag the review found missing from the usage.
  expect(commandHelp("test")).toContain("--against PATH...")
})

test("a usage error prints that command's help, not every command's", async () => {
  const cwd = await createProject({ ".rulecast-config.yaml": "repos: []\n" })
  const result = await runCli(cwd, ["run", "--bogus"])
  expect(result.code).toBe(2)
  expect(result.stderr).toContain(commandHelp("run")!)
  expect(result.stderr).not.toContain("rulecast init [")
})

test("check is gone", async () => {
  const cwd = await createProject({})
  const result = await runCli(cwd, ["check"])
  expect(result.code).toBe(2)
  expect(result.stderr).toContain('unknown command "check"')
})

/** The README's command table and COMMANDS name the same commands, in both directions. */
test("the README's command table lists exactly the commands rulecast has", () => {
  const readme = readFileSync(fileURLToPath(new URL("../../../../README.md", import.meta.url)), "utf8")
  const rows = readme.split("\n").filter((line) => line.startsWith("| `rulecast "))
  const named = new Set(
    rows.flatMap((row) => [...row.split("|")[1]!.matchAll(/`(?:rulecast )?([a-z-]+)/g)].map((match) => match[1]!)),
  )
  expect([...named].sort()).toEqual(COMMANDS.map((command) => command.name).sort())
})
