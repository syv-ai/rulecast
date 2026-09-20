import { execFile, spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { beforeAll, expect, test } from "vitest"

import { createCatalogRepo } from "./helpers/catalog"
import { localConfig } from "./helpers/config"
import { createFixture } from "./helpers/fixture"
import { createRepo } from "./helpers/git"
import { TEST_HOME } from "./helpers/home"
import { claudeCodePayload } from "./helpers/payloads"

const exec = promisify(execFile)
const cli = path.resolve("dist/cli.js")
const env = { ...process.env, RULECAST_HOME: TEST_HOME }

beforeAll(async () => {
  await exec("pnpm", ["build"])
}, 60_000)

test("built CLI runs rulecast run in a project", async () => {
  const root = await createFixture()
  const failure = await exec("node", [cli, "run", "--all-files", "--format", "agent"], { cwd: root, env }).catch(
    (error) => error,
  )
  expect(failure.code).toBe(1)
  expect(failure.stdout).toContain("rulecast: 2 rules violated")
  expect(failure.stdout).toContain("--- conventions/backend.md#errors ---")
}, 30_000)

test("built CLI answers a Claude Code edit hook", async () => {
  const root = await createFixture()
  await writeFile(
    path.join(root, "app/services/users.py"),
    "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n",
  )
  const payload = claudeCodePayload("post-tool-use.edit", { root, file: "app/services/users.py", sessionId: "s1" })
  const result = spawnSync(process.execPath, [cli, "hook", "claude-code"], {
    cwd: root,
    env,
    input: JSON.stringify(payload),
    encoding: "utf8",
  })
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain("raises HTTPException(500)")
}, 30_000)

test("built CLI runs init --yes and keeps @clack/prompts out of its entry", async () => {
  const root = await createRepo({ "app/services/users.py": "x = 1\n", "CLAUDE.md": "# Project\n" })
  const catalog = await createCatalogRepo()
  const result = spawnSync(process.execPath, [cli, "init", "--yes"], {
    cwd: root,
    encoding: "utf8",
    env: { ...env, RULECAST_CATALOG: catalog },
  })
  expect(result.stderr).toBe("")
  expect(result.status).toBe(0)
  expect(existsSync(path.join(root, ".rulecast-config.yaml"))).toBe(true)
  expect(existsSync(path.join(root, ".claude/settings.json"))).toBe(true)
  expect(result.stdout).toContain("from CLAUDE.md.")
  // The prompter is a separate chunk (Decision 2): hooks never load it. The entry only reaches it
  // through the dynamic import, so @clack/prompts is imported from that chunk and never from cli.js.
  // Static `from "x"` and dynamic `import("x")`.
  const imports = (file: string) =>
    [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((match) => match[1]!)
  expect(imports(cli)).not.toContain("@clack/prompts")
  const chunk = imports(cli).find((specifier) => /^\.\/clack-\w+\.js$/.test(specifier))
  expect(chunk, "cli.js dynamically imports the clack chunk").toBeDefined()
  expect(imports(path.join(path.dirname(cli), chunk!))).toContain("@clack/prompts")
}, 60_000)

test("built package reaches ast-grep only through a dynamic import", () => {
  // A static import anywhere would load the native module in every hook process, including the
  // many projects with no ast-grep rule. tsup splits builtinDetectors into a chunk that both
  // entries import, so the specifier lives there, not in cli.js: what matters is that loading
  // the chunk does not load the native module. load.ts's import() is the only way in.
  const dir = path.dirname(cli)
  const sources = readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => [name, readFileSync(path.join(dir, name), "utf8")] as const)
  for (const [name, source] of sources) {
    expect(source, `${name} must not import ast-grep statically`).not.toMatch(/from\s*"@ast-grep\/[\w-]+"/)
  }
  const dynamic = (specifier: string) => sources.some(([, source]) => source.includes(`import("${specifier}")`))
  expect(dynamic("@ast-grep/napi"), "a chunk dynamically imports @ast-grep/napi").toBe(true)
  expect(dynamic("@ast-grep/lang-python"), "a chunk dynamically imports @ast-grep/lang-python").toBe(true)
})

test("built CLI runs an ast-grep rule", async () => {
  const root = await createRepo({
    ".rulecast-config.yaml": localConfig([
      {
        id: "no-silent-except",
        name: "No silent except",
        files: "\\.py$",
        detect: {
          "ast-grep": {
            language: "python",
            rule: { kind: "except_clause", has: { kind: "block", has: { kind: "pass_statement" } } },
          },
        },
        message: "{{file}}:{{line}} swallows an exception.",
      },
    ]),
    "app/a.py": "def f():\n    try:\n        g()\n    except ValueError:\n        pass\n",
  })
  const failure = await exec("node", [cli, "run", "--all-files", "--format", "agent"], { cwd: root, env }).catch(
    (error) => error,
  )
  expect(failure.code).toBe(1)
  expect(failure.stdout).toContain("app/a.py:4 swallows an exception.")
}, 30_000)

test("built package exports the contract suites and imports no test framework", async () => {
  const entry = path.resolve("dist/index.js")
  const source = readFileSync(entry, "utf8")
  for (const framework of ["vitest", "node:test", "@jest/globals"]) {
    expect(source, `dist/index.js must not import ${framework}`).not.toContain(`"${framework}"`)
  }
  const exported = await import(pathToFileURL(entry).href)
  expect(typeof exported.detectorContract).toBe("function")
  expect(typeof exported.adapterContract).toBe("function")
}, 30_000)
