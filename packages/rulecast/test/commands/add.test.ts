import { readFile } from "node:fs/promises"
import path from "node:path"
import { beforeAll, describe, expect, test } from "vitest"
import { parse } from "yaml"

import { CONFIG_FILE } from "../../src/core/config/load"
import type { Env } from "../../src/core/home"
import { createCatalogRepo } from "../helpers/catalog"
import { runCli } from "../helpers/cli"
import { createRepo } from "../helpers/git"
import { testEnv } from "../helpers/home"

let catalog: string
let env: Env

/** The catalog has no llm rule, so the consent test adds one. */
const LLM_RULE = `- id: fixture/thin-handlers
  name: Handlers stay thin
  description: A model judges whether a handler does more than parse input, call a service and return.
  files: (^|/)api/.*\\.py$
  severity: warning
  detect:
    llm:
      model: haiku
      question: Does this handler do more than parse input, call a service and return the result?
  message: "{{file}}:{{line}} {{reason}}"
`

beforeAll(async () => {
  catalog = await createCatalogRepo(LLM_RULE)
  env = { ...testEnv, RULECAST_CATALOG: catalog }
}, 30_000)

const PROJECT: Record<string, string> = {
  "app/api/users.py": "def list_users():\n    return svc.list()\n",
  "tests/test_users.py": "def test_get():\n    assert get() is None\n",
  [CONFIG_FILE]: "# ours\nrepos:\n  - repo: local\n    rules: []\n",
}

const LOOP_SAFETY = [
  "loop-safety/no-config-suppressions-js",
  "loop-safety/no-config-suppressions-python",
  "loop-safety/no-deleted-assertions-js",
  "loop-safety/no-deleted-assertions-python",
  "loop-safety/no-deleted-assertions-ts",
  "loop-safety/no-lowered-thresholds",
  "loop-safety/no-new-suppressions",
  "loop-safety/no-skipped-tests-js",
  "loop-safety/no-skipped-tests-python",
  "loop-safety/no-skipped-tests-ts",
  "loop-safety/protected-loop-config",
]

const read = (root: string) => readFile(path.join(root, CONFIG_FILE), "utf8")
const catalogIds = (text: string) =>
  (parse(text) as { repos: { repo: string; rules: { id: string }[] }[] }).repos
    .filter((repo) => repo.repo !== "local")
    .flatMap((repo) => repo.rules.map((rule) => rule.id))
    .sort()

describe("rulecast add", () => {
  test("adds one catalog rule, pinned to the catalog's latest tag, keeping the config's text", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["add", "python/no-silent-except"], "", env)
    expect(result.code).toBe(0)
    const text = await read(root)
    expect(text.startsWith("# ours\n")).toBe(true)
    expect(catalogIds(text)).toEqual(["python/no-silent-except"])
    expect(text).toContain("rev: v0.2.0")
    expect(result.stdout).toContain("python/no-silent-except")
    expect(result.stdout).toContain("rulecast validate: 1 rule valid")
  })

  test("a pack's name adds all of its rules, and they validate", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["add", "loop-safety"], "", env)
    expect(result.code).toBe(0)
    expect(catalogIds(await read(root))).toEqual(LOOP_SAFETY)
    expect(result.stdout).toContain("rulecast validate: 11 rules valid")
  })

  test("an llm rule is added when named: naming it is the consent", async () => {
    const root = await createRepo({ ...PROJECT, [CONFIG_FILE]: "llm:\n  model: haiku\nrepos: []\n" })
    const result = await runCli(root, ["add", "fixture/thin-handlers"], "", env)
    expect(result.code).toBe(0)
    expect(catalogIds(await read(root))).toEqual(["fixture/thin-handlers"])
  })

  test("rules already configured are skipped and named; a partial pack gets only what is missing", async () => {
    const root = await createRepo(PROJECT)
    await runCli(root, ["add", "loop-safety/no-new-suppressions"], "", env)
    const result = await runCli(root, ["add", "loop-safety"], "", env)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Already configured: loop-safety/no-new-suppressions")
    const ids = catalogIds(await read(root))
    expect(ids).toEqual(LOOP_SAFETY)
    expect(new Set(ids).size).toBe(ids.length)
    const again = await runCli(root, ["add", "loop-safety/no-new-suppressions"], "", env)
    expect(again.stdout).toContain("Nothing to add.")
  })

  test("an unknown id is a usage error and writes nothing", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["add", "python/no-silent-except", "nope/missing"], "", env)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('"nope/missing" is not a rule or pack')
    expect(await read(root)).toBe(PROJECT[CONFIG_FILE])
  })

  test("without a config it says to set rulecast up first", async () => {
    const root = await createRepo({ "a.py": "x = 1\n" })
    const result = await runCli(root, ["add", "python/no-silent-except"], "", env)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("set rulecast up first")
  })
})

describe("rulecast list --catalog", () => {
  test("lists the catalog, marking configured rules, packs, costs and matching files", async () => {
    const root = await createRepo(PROJECT)
    await runCli(root, ["add", "python/no-silent-except"], "", env)
    const json = JSON.parse((await runCli(root, ["list", "--catalog", "--format", "json"], "", env)).stdout) as {
      id: string
      installed: boolean
      pack: string | null
      cost: string | null
      matchingFiles: number | null
    }[]
    const byId = new Map(json.map((entry) => [entry.id, entry]))
    expect(byId.get("python/no-silent-except")!.installed).toBe(true)
    expect(byId.get("loop-safety/no-new-suppressions")!.pack).toBe("loop-safety")
    expect(byId.get("fixture/thin-handlers")!.cost).toContain("sends file contents")
    expect(byId.get("fixture/thin-handlers")!.matchingFiles).toBe(1)
    const terminal = (await runCli(root, ["list", "--catalog"], "", env)).stdout
    expect(terminal).toMatch(/^Catalog: \S+@v0\.2\.0\n/)
    expect(terminal).toContain("python/no-silent-except")
    expect(terminal).toContain("(configured)")
    expect(terminal).toContain("Pack loop-safety: For agents that run with nobody watching")
  })

  test("with a rule id, shows that rule with its message and cited sections", async () => {
    const root = await createRepo(PROJECT)
    const result = await runCli(root, ["list", "--catalog", "python/no-silent-except"], "", env)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("message ")
    expect(result.stdout).toMatch(/--- .+ ---/)
  })
})
