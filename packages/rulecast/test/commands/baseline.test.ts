import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { stringify } from "yaml"
import { z } from "zod"

import { baselineCommand } from "../../src/commands/baseline"
import { createRegistry } from "../../src/core/detection/registry"
import type { Detector } from "../../src/core/types"
import { builtinDetectors } from "../../src/detectors"
import { captureIo, runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { fixtureFiles, fixtureRules } from "../helpers/fixture"
import { createRepo, git } from "../helpers/git"
import { createProject } from "../helpers/project"

/**
 * `rulecast baseline` and the runs that read what it writes: a scheduled full-repository loop has
 * no ref to diff against, and needs "exit 0 unless something got worse" all the same.
 */
const USERS = "app/services/users.py"
const FILE = ".rulecast/baseline.json"
const LEGACY = "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n"

type Finding = { id: string; rule: string; line: number; status: string; captures?: Record<string, string> }
type Report = {
  complete: boolean
  findings: Finding[]
  preexisting: Finding[]
  warnings: string[]
  baseline: { file: string; entries: number; matched: number; stale: number } | null
}

const baseline = (root: string, ...flags: string[]) => runCli(root, ["baseline", ...flags])
const run = (root: string, ...flags: string[]) => runCli(root, ["run", ...flags])
const report = async (root: string, ...flags: string[]) => {
  const result = await run(root, ...flags, "--format", "json")
  return { code: result.code, ...(JSON.parse(result.stdout) as Report) }
}
const stored = async (root: string) => JSON.parse(await readFile(path.join(root, FILE), "utf8"))
const ids = async (root: string) => {
  const document = await stored(root)
  return Object.values(document.rules as Record<string, { files: Record<string, string[]> }>).flatMap((rule) =>
    Object.values(rule.files).flat(),
  )
}

/** Two legacy HTTPException raises and the generated-client warning, committed. */
const legacyRepo = () => createRepo({ ...fixtureFiles, [USERS]: LEGACY })

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("rulecast baseline", () => {
  test("after a baseline a full run passes, and one new violation fails with only that one new", async () => {
    const root = await legacyRepo()
    const written = await baseline(root)
    expect(written.code).toBe(0)
    expect(written.stdout).toContain(`wrote ${FILE}: 3 findings, 2 rules, 2 files. Commit it`)
    expect((await stored(root)).rules["backend/no-httpexception"].files[USERS]).toHaveLength(2)

    const clean = await report(root, "--all-files")
    expect(clean.code).toBe(0)
    expect(clean.findings).toEqual([])
    expect(clean.preexisting.map((finding) => [finding.rule, finding.line])).toEqual([
      ["backend/no-httpexception", 2],
      ["backend/no-httpexception", 3],
      ["frontend/no-generated-edits", 1],
    ])
    expect(clean.baseline).toEqual({ file: FILE, entries: 3, matched: 3, stale: 0 })

    await writeFile(path.join(root, USERS), `${LEGACY}    raise HTTPException(418)\n`)
    const worse = await report(root, "--all-files")
    expect(worse.code).toBe(1)
    expect(worse.findings.map((finding) => [finding.line, finding.captures?.args])).toEqual([[4, "418"]])
    expect(await ids(root)).not.toContain(worse.findings[0]!.id)
    expect(worse.preexisting).toHaveLength(3)
  })

  test("a fixed violation is reported stale, --prune removes it, and bringing it back is new", async () => {
    const root = await legacyRepo()
    await baseline(root)
    await writeFile(path.join(root, USERS), "def get():\n    raise HTTPException(404)\n")

    const terminal = await run(root, "--all-files")
    expect(terminal.code).toBe(0)
    expect(terminal.stdout).toContain(
      "baseline: 1 entry no longer found (fixed or changed); rulecast baseline --prune drops them",
    )
    expect((await report(root, "--all-files")).baseline).toMatchObject({ entries: 3, matched: 2, stale: 1 })

    const pruned = await baseline(root, "--prune")
    expect(pruned.code).toBe(0)
    expect(pruned.stdout).toContain("pruned 1 entry:\n  backend/no-httpexception  app/services/users.py  −1\n")
    expect(pruned.stdout).toContain(`${FILE}: 2 findings, 2 rules, 2 files`)
    expect((await stored(root)).rules["backend/no-httpexception"].files[USERS]).toHaveLength(1)
    expect((await report(root, "--all-files")).baseline).toMatchObject({ entries: 2, stale: 0 })

    await writeFile(path.join(root, USERS), LEGACY)
    const back = await report(root, "--all-files")
    expect(back.code).toBe(1)
    expect(back.findings.map((finding) => [finding.line, finding.status])).toEqual([[3, "new"]])
  })

  test("--prune never adds a finding, says so, and leaves the file as it was", async () => {
    const root = await legacyRepo()
    await baseline(root)
    const before = await readFile(path.join(root, FILE), "utf8")
    await writeFile(path.join(root, USERS), `${LEGACY}    raise HTTPException(418)\n`)
    const result = await baseline(root, "--prune")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("nothing to prune")
    expect(result.stdout).toContain(
      "1 new finding is not added; fix it, or rulecast baseline --force to rewrite the file",
    )
    expect(await readFile(path.join(root, FILE), "utf8")).toBe(before)
  })

  test("--prune keeps the entries of a rule that did not run, and twice is the same as once", async () => {
    const root = await legacyRepo()
    await baseline(root)
    const before = await readFile(path.join(root, FILE), "utf8")
    await writeFile(path.join(root, USERS), "def get():\n    pass\n")
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      localConfig(
        fixtureRules.map((rule) => (rule.id === "backend/no-httpexception" ? { ...rule, enabled: false } : rule)),
      ),
    )
    expect((await baseline(root, "--prune")).stdout).toContain("nothing to prune")
    expect(await readFile(path.join(root, FILE), "utf8")).toBe(before)

    await writeFile(path.join(root, ".rulecast-config.yaml"), localConfig(fixtureRules))
    expect((await baseline(root, "--prune")).stdout).toContain("pruned 2 entries")
    const once = await readFile(path.join(root, FILE), "utf8")
    expect((await baseline(root, "--prune")).stdout).toContain("nothing to prune")
    expect(await readFile(path.join(root, FILE), "utf8")).toBe(once)
  })

  test("a rule removed from the config has its entries pruned", async () => {
    const root = await legacyRepo()
    await baseline(root)
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      localConfig(fixtureRules.filter((rule) => rule.id !== "frontend/no-generated-edits")),
    )
    expect((await baseline(root, "--prune")).stdout).toContain("frontend/no-generated-edits  src/client/api.ts  −1")
    expect(Object.keys((await stored(root)).rules)).toEqual(["backend/no-httpexception"])
  })

  test("an existing file is not rewritten without --force, and --force gives the same bytes twice", async () => {
    const root = await legacyRepo()
    await baseline(root)
    const refused = await baseline(root)
    expect(refused.code).toBe(2)
    expect(refused.stdout).toBe("")
    expect(refused.stderr).toContain(`${FILE} exists: rulecast baseline --prune shrinks it; --force rewrites it`)

    await writeFile(path.join(root, USERS), `${LEGACY}    raise HTTPException(418)\n`)
    expect((await baseline(root, "--force")).code).toBe(0)
    const first = await readFile(path.join(root, FILE), "utf8")
    expect(JSON.parse(first).total).toBe(4)
    expect((await baseline(root, "--force")).code).toBe(0)
    expect(await readFile(path.join(root, FILE), "utf8")).toBe(first)
    expect(first.endsWith("\n")).toBe(true)
  })

  test("--prune with no file, and --prune with --force, are errors", async () => {
    const root = await legacyRepo()
    expect(await baseline(root, "--prune")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining(`no ${FILE} to prune`),
    })
    expect(await baseline(root, "--prune", "--force")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("--prune and --force cannot be combined"),
    })
  })

  test("a run where a rule could not run writes nothing and exits 3", async () => {
    const root = await createRepo({
      ...fixtureFiles,
      ".rulecast-config.yaml": localConfig([
        ...fixtureRules,
        { id: "broken", name: "Broken", files: "\\.py$", detect: { regex: { pattern: "([unclosed" } }, message: "m" },
      ]),
    })
    const result = await baseline(root)
    expect(result.code).toBe(3)
    expect(result.stdout).toContain("not written: some rules did not run")
    expect(existsSync(path.join(root, FILE))).toBe(false)
  })

  test("the file is not ignored by git: rulecast's own .gitignore lets it through, and an old one is migrated", async () => {
    const root = await legacyRepo()
    await mkdir(path.join(root, ".rulecast"), { recursive: true })
    await writeFile(
      path.join(root, ".rulecast/.gitignore"),
      "# Written by rulecast: files its hooks point an agent at.\n*\n",
    )
    const result = await baseline(root)
    expect(result.stdout).not.toContain("git ignores")
    expect(await readFile(path.join(root, ".rulecast/.gitignore"), "utf8")).toContain("!baseline.json")
    await expect(git(root, "check-ignore", "-q", FILE)).rejects.toThrow()
    await git(root, "add", FILE)
    expect(await git(root, "status", "--porcelain")).toContain(`A  ${FILE}`)
  })

  test("an old rulecast .gitignore the project edited is left alone", async () => {
    const root = await legacyRepo()
    await mkdir(path.join(root, ".rulecast"), { recursive: true })
    const edited = "# Written by rulecast: files its hooks point an agent at.\n*\n!notes.md\n"
    await writeFile(path.join(root, ".rulecast/.gitignore"), edited)
    const result = await baseline(root)
    expect(await readFile(path.join(root, ".rulecast/.gitignore"), "utf8")).toBe(edited)
    expect(result.stdout).toContain(`git ignores ${FILE} (.rulecast/.gitignore:2:*): add !baseline.json`)
  })

  test("a directory pattern elsewhere is named, with a hint that can work", async () => {
    const root = await createRepo({ ...fixtureFiles, [USERS]: LEGACY, ".gitignore": ".rulecast/\n" })
    const result = await baseline(root)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      `git ignores ${FILE} (.gitignore:1:.rulecast/): narrow or remove that pattern, or commit it with git add -f ${FILE}`,
    )
    expect(result.stdout).not.toContain("add !baseline.json")
  })

  test("a .gitignore the project wrote is left alone, with a hint", async () => {
    const root = await legacyRepo()
    await mkdir(path.join(root, ".rulecast"), { recursive: true })
    await writeFile(path.join(root, ".rulecast/.gitignore"), "*\n")
    const result = await baseline(root)
    expect(result.code).toBe(0)
    expect(await readFile(path.join(root, ".rulecast/.gitignore"), "utf8")).toBe("*\n")
    expect(result.stdout).toContain(`git ignores ${FILE} (.rulecast/.gitignore:1:*): add !baseline.json`)
  })

  test("no rule ever reads rulecast's own directory, so the baseline cannot fire a rule", async () => {
    const root = await legacyRepo()
    await baseline(root)
    await git(root, "add", "-A")
    await git(root, "commit", "-q", "-m", "baseline")
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      localConfig([
        {
          id: "json/hex",
          name: "Hex",
          files: "\\.json$",
          detect: { regex: { pattern: "[0-9a-f]{16}" } },
          message: "m",
        },
      ]),
    )
    const result = await report(root, "--all-files")
    expect(result.findings).toEqual([])
    expect(result.code).toBe(0)
  })
})

describe("which runs use the committed baseline", () => {
  test("--files uses it", async () => {
    const root = await legacyRepo()
    await baseline(root)
    const result = await report(root, "--files", USERS)
    expect(result.code).toBe(0)
    expect(result.preexisting).toHaveLength(2)
    expect(result.baseline).toMatchObject({ entries: 3, matched: 2, stale: 0 })
  })

  test("--from-ref keeps its own: a touched baselined line is new, and the key is null", async () => {
    const root = await legacyRepo()
    await baseline(root)
    await git(root, "add", "-A")
    await git(root, "commit", "-q", "-m", "baseline")
    await git(root, "checkout", "-q", "-b", "feature")
    // The same text, so the same id: only the line was touched.
    await writeFile(path.join(root, USERS), LEGACY.replace("(404)", "(404)  # touched"))
    const result = await report(root, "--from-ref", "main")
    expect(result.code).toBe(1)
    expect(result.findings.map((finding) => [finding.line, finding.status])).toEqual([[2, "new"]])
    expect(await ids(root)).toContain(result.findings[0]!.id)
    expect(result.baseline).toBeNull()
  })

  test("a staged run with a HEAD keeps HEAD as its baseline", async () => {
    const root = await legacyRepo()
    await baseline(root)
    await writeFile(path.join(root, USERS), LEGACY.replace("(404)", "(404)  # touched"))
    await git(root, "add", USERS)
    const result = await report(root)
    expect(result.code).toBe(1)
    expect(result.findings.map((finding) => finding.line)).toEqual([2])
    expect(result.baseline).toBeNull()
  })

  test("a staged run before the first commit uses it", async () => {
    const root = await createProject({ ...fixtureFiles, [USERS]: LEGACY })
    await git(root, "init", "-q", "-b", "main")
    expect((await baseline(root)).code).toBe(0)
    await git(root, "add", "-A")
    const clean = await report(root)
    expect(clean.code).toBe(0)
    expect(clean.findings).toEqual([])
    expect(clean.baseline).toMatchObject({ entries: 3, matched: 3 })

    await writeFile(path.join(root, USERS), `${LEGACY}    raise HTTPException(418)\n`)
    await git(root, "add", USERS)
    const worse = await report(root)
    expect(worse.code).toBe(1)
    expect(worse.findings.map((finding) => finding.line)).toEqual([4])
  })

  test("try-repo does not read it", async () => {
    const root = await legacyRepo()
    await baseline(root)
    // The same rule id as the project's, so its ids would match the file if try-repo read it.
    const repo = await createProject({ ".rulecast-rules.yaml": stringify([fixtureRules[0]]) })
    const result = await runCli(root, ["try-repo", repo, "--all-files", "--format", "json"])
    expect(JSON.parse(result.stdout).baseline).toBeNull()
  })

  test("a malformed file stops the run with nothing on stdout", async () => {
    const root = await legacyRepo()
    await mkdir(path.join(root, ".rulecast"), { recursive: true })
    await writeFile(path.join(root, FILE), "{}")
    const result = await run(root, "--all-files", "--format", "json")
    expect(result.code).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(`${FILE}: version:`)
    expect(result.stderr).toContain("rulecast baseline --force")
  })

  test("ids from another scheme are a warning, and every finding is new", async () => {
    const root = await legacyRepo()
    await baseline(root)
    const document = await stored(root)
    await writeFile(path.join(root, FILE), JSON.stringify({ ...document, findingIdVersion: 99 }))
    const result = await report(root, "--all-files")
    expect(result.code).toBe(1)
    expect(result.complete).toBe(true)
    expect(result.findings).toHaveLength(3)
    expect(result.warnings).toEqual([expect.stringContaining("ids of scheme v99")])
    expect(result.baseline).toBeNull()
  })
})

describe("rulecast doctor and the baseline", () => {
  test("none, not committed, then its size with the dates it was added and last changed", async () => {
    vi.stubEnv("PATH", "/usr/bin:/bin")
    const root = await legacyRepo()
    expect((await runCli(root, ["doctor"])).stdout).toContain(
      "baseline   none (rulecast baseline writes one; --from-ref is preferred wherever a ref exists)",
    )
    await baseline(root)
    expect((await runCli(root, ["doctor"])).stdout).toContain(
      `baseline   ${FILE} — 3 findings, 2 rules, 2 files; not committed yet`,
    )
    vi.stubEnv("GIT_COMMITTER_DATE", "2026-03-02T12:00:00Z")
    await git(root, "add", FILE)
    await git(root, "commit", "-q", "-m", "baseline")
    await writeFile(path.join(root, USERS), "def get():\n    raise HTTPException(404)\n")
    await baseline(root, "--prune")
    vi.stubEnv("GIT_COMMITTER_DATE", "2026-09-30T12:00:00Z")
    await git(root, "commit", "-q", "-am", "prune")
    const stdout = (await runCli(root, ["doctor"])).stdout
    expect(stdout).toMatch(
      /baseline {3}\.rulecast\/baseline\.json — 2 findings, 2 rules, 2 files; added 2026-03-02 \(\d+ days ago\), last changed 2026-09-30 \((\d+ days ago|today|yesterday)\)\n/,
    )
  })

  test("a malformed file is a warning", async () => {
    vi.stubEnv("PATH", "/usr/bin:/bin")
    const root = await legacyRepo()
    await mkdir(path.join(root, ".rulecast"), { recursive: true })
    await writeFile(path.join(root, FILE), "nope")
    const stdout = (await runCli(root, ["doctor"])).stdout
    expect(stdout).toContain(`baseline   ${FILE} — cannot be used\n  warning  ${FILE}: not JSON`)
  })
})

const paidSchema = z.object({}).strict()

/** A metered detector with a budget of one file, firing once on every file it is given. */
const paidDetector: Detector<z.infer<typeof paidSchema>> = {
  kind: "paid",
  schema: paidSchema,
  captures: () => [],
  events: () => ["verify"],
  metered: true,
  cost: () => "paid · bills per file",
  fileBudget: () => ({ max: 1, setting: "paid.max_files" }),
  async run(input) {
    return {
      findings: input.rules.flatMap((one) =>
        one.files.map((file) => ({
          rule: one.id,
          match: { file, line: 1, endLine: 1, column: 1, text: "", captures: {} },
        })),
      ),
      errors: [],
    }
  },
}

describe("rulecast baseline and metered rules", () => {
  const PAID = "paid/rule"
  const paidRepo = () =>
    createRepo({
      ...fixtureFiles,
      [USERS]: LEGACY,
      "app/a.py": "x = 1\n",
      "app/b.py": "y = 2\n",
      ".rulecast-config.yaml": localConfig([
        ...fixtureRules,
        { id: PAID, name: "Paid", files: "^app/[ab]\\.py$", stages: ["verify"], detect: { paid: {} }, message: "m" },
      ]),
    })
  const paidBaseline = async (root: string, ...flags: string[]) => {
    const { io, output } = captureIo(root)
    const code = await baselineCommand(root, flags, createRegistry([...builtinDetectors, paidDetector]), io)
    return { code, ...output }
  }

  test("the file budget does not apply: every file a metered rule matches is in the baseline", async () => {
    const root = await paidRepo()
    const result = await paidBaseline(root)
    expect(result.code).toBe(0)
    expect(result.stdout).not.toContain("were not checked")
    expect(Object.keys((await stored(root)).rules[PAID].files)).toEqual(["app/a.py", "app/b.py"])
  })

  test("--no-llm writes the rest and names the rules left out", async () => {
    const root = await paidRepo()
    const result = await paidBaseline(root, "--no-llm")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`not in the baseline (--no-llm): ${PAID}`)
    expect(Object.keys((await stored(root)).rules)).not.toContain(PAID)
  })

  test("--force --no-llm keeps the entries of the rules it skipped", async () => {
    const root = await paidRepo()
    await paidBaseline(root)
    const before = (await stored(root)).rules[PAID]
    await writeFile(path.join(root, USERS), `${LEGACY}    raise HTTPException(418)\n`)
    const result = await paidBaseline(root, "--force", "--no-llm")
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`kept from the old baseline, for rules that did not run: ${PAID}`)
    const after = await stored(root)
    expect(after.rules[PAID]).toEqual(before)
    expect(after.rules["backend/no-httpexception"].count).toBe(3)
  })
})
