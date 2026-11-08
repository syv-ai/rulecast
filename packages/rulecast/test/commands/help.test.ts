import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

import { EXIT_CODES, TRY_REPO_EXIT_CODES } from "../../src/adapters/cli/contract"
import { COMMANDS, commandHelp, usage } from "../../src/commands/help"
import { VERSION } from "../../src/core/version"
import { runCli } from "../helpers/cli"
import { createProject } from "../helpers/project"

const basic = COMMANDS.filter((command) => command.tier === "basic")
const advanced = COMMANDS.filter((command) => command.tier === "advanced")

test("help lists the basic commands and names the advanced ones", async () => {
  const cwd = await createProject({})
  for (const flag of ["help", "--help", "-h"]) {
    const result = await runCli(cwd, [flag])
    expect(result).toMatchObject({ code: 0, stdout: usage() })
    for (const command of basic) {
      expect(result.stdout).toContain(`  ${command.name}`)
      expect(result.stdout).toContain(command.summary)
    }
    for (const command of advanced) expect(result.stdout).not.toContain(command.summary)
    expect(result.stdout).toContain(
      "\nAdvanced: baseline, replay, autoupdate, try-repo, clean, warm, hook (rulecast help --all)\n",
    )
  }
})

test("help --all lists every command, advanced ones under their own heading", async () => {
  const cwd = await createProject({})
  for (const argv of [
    ["help", "--all"],
    ["--help", "--all"],
    ["-h", "--all"],
  ]) {
    const result = await runCli(cwd, argv)
    expect(result).toMatchObject({ code: 0, stdout: usage({ all: true }) })
    for (const command of COMMANDS) expect(result.stdout).toContain(command.summary)
    const heading = result.stdout.indexOf("\nAdvanced:\n")
    expect(heading).toBeGreaterThan(-1)
    for (const command of basic) expect(result.stdout.indexOf(command.summary)).toBeLessThan(heading)
    for (const command of advanced) expect(result.stdout.indexOf(command.summary)).toBeGreaterThan(heading)
    expect(result.stdout).not.toContain("(rulecast help --all)")
  }
})

test("every command still has its own help, advanced ones included", async () => {
  const cwd = await createProject({})
  for (const command of COMMANDS) {
    for (const argv of [
      [command.name, "--help"],
      ["help", command.name],
    ]) {
      expect(await runCli(cwd, argv)).toMatchObject({ code: 0, stdout: commandHelp(command.name) })
    }
  }
})

test("the basic list is the shorter one", () => {
  expect(basic.map((command) => command.name)).toEqual([
    "init",
    "install",
    "uninstall",
    "run",
    "fix",
    "list",
    "add",
    "test",
    "stats",
    "validate",
    "doctor",
  ])
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
  expect(commandHelp("doctor")).toContain("--ci")
  expect(commandHelp("doctor")).toContain("--from-ref REF")
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

const repoFile = (file: string) => readFileSync(fileURLToPath(new URL(`../../../../${file}`, import.meta.url)), "utf8")

/** The commands a Markdown table's rows name, sorted. */
function tableCommands(text: string): string[] {
  const rows = text.split("\n").filter((line) => line.startsWith("| `rulecast "))
  return [
    ...new Set(
      rows.flatMap((row) => [...row.split("|")[1]!.matchAll(/`(?:rulecast )?([a-z-]+)/g)].map((match) => match[1]!)),
    ),
  ].sort()
}

/**
 * The README's command table names the basic tier and the commands guide's the advanced one, as
 * COMMANDS does, in both directions.
 */
test("the README and the commands guide list each tier's commands", () => {
  const readme = repoFile("README.md")
  const start = readme.indexOf("\n## Commands\n")
  const end = readme.indexOf("\n## ", start + 1)
  expect(start).toBeGreaterThan(-1)
  const names = (commands: typeof COMMANDS) => commands.map((command) => command.name).sort()
  expect(tableCommands(readme.slice(start, end))).toEqual(names(basic))
  expect(tableCommands(readme.slice(0, start) + readme.slice(end))).toEqual([])
  const guide = repoFile("guides/commands.md")
  const advancedStart = guide.indexOf("## Advanced commands")
  expect(advancedStart).toBeGreaterThan(-1)
  expect(tableCommands(guide.slice(advancedStart))).toEqual(names(advanced))
  expect(tableCommands(guide.slice(0, advancedStart))).toEqual([])
})

test("run --help and try-repo --help print the exit codes", async () => {
  const cwd = await createProject({})
  for (const [command, codes] of [
    ["run", EXIT_CODES],
    ["try-repo", TRY_REPO_EXIT_CODES],
  ] as const) {
    const result = await runCli(cwd, [command, "--help"])
    for (const [code, meaning] of codes) expect(result.stdout).toContain(`  ${code}  ${meaning}`)
    expect(result.stdout).toContain("agents/reference/output.md")
  }
})

/** The commands guide's exit-code table says exactly what EXIT_CODES says, so the two cannot drift apart. */
test("the commands guide's exit-code table matches the codes rulecast exits with", () => {
  const guide = repoFile("guides/commands.md")
  const section = guide.slice(guide.indexOf("## Exit codes"))
  const rows = section
    .split("\n")
    .filter((line) => /^\| `\d+` \|/.test(line))
    .map((row) => {
      const [, code, meaning] = row.split("|").map((cell) => cell.trim())
      return [Number(code!.replaceAll("`", "")), meaning]
    })
  expect(rows).toEqual(EXIT_CODES)
})

test("baseline --help scopes writing nothing to create and --force: --prune still writes", async () => {
  const result = await runCli(await createProject({}), ["baseline", "--help"])
  expect(result.stdout.replace(/\s+/g, " ")).toContain(
    "Without --prune, exits 3 and writes nothing when a rule could not run; --prune drops only what it could check and exits 3.",
  )
})
