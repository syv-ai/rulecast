import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo, git } from "../helpers/git"
import { stubAgentCli } from "../helpers/llm"

const PY = "app/services/users.py"
const RULE = "backend/no-httpexception"

const httpException = {
  id: RULE,
  name: "No HTTPException in services",
  files: "^app/services/.*\\.py$",
  detect: { regex: { pattern: "raise HTTPException" } },
  message: "{{file}}:{{line}} raises HTTPException",
}

const judgement = {
  id: "backend/judgement",
  name: "Judgement",
  files: "^app/services/.*\\.py$",
  detect: { llm: { model: "haiku", question: "Does this need judgement? Report each offending line." } },
  message: "{{file}}:{{line}} needs judgement. {{reason}}",
}

/**
 * A project whose history has, after the first commit: one commit that adds a violation, one that
 * changes the same file without adding one (beside the violation it already has), and one that
 * changes no file the rule matches.
 */
async function withHistory(rules: Record<string, unknown>[] = [httpException]) {
  const root = await createRepo({ ".rulecast-config.yaml": localConfig(rules), [PY]: "def get():\n    return 1\n" })
  const commit = async (file: string, content: string, subject: string) => {
    await writeFile(path.join(root, file), content)
    await git(root, "add", file)
    await git(root, "commit", "-q", "-m", subject)
    return git(root, "rev-parse", "HEAD")
  }
  const breaking = await commit(PY, "def get():\n    raise HTTPException(404)\n", "breaks it")
  await commit(PY, "def get():\n    raise HTTPException(404)\n\ndef put():\n    return 2\n", "keeps it")
  await commit("README.md", "# readme\n", "docs")
  return { root, breaking }
}

const json = (stdout: string) => JSON.parse(stdout)

describe("rulecast test --history", () => {
  test("judges each commit that changes the rule's files on what the commit added", async () => {
    const { root, breaking } = await withHistory()
    const result = await runCli(root, ["test", RULE, "--history", "--format", "json"])
    expect(result).toMatchObject({ code: 0, stderr: "" })
    const report = json(result.stdout).rules[0]
    expect(report.status).toBe("passed")
    expect(report.history).toMatchObject({
      commits: 2,
      commitsFired: 1,
      rate: 0.5,
      smallSample: true,
      exceeded: false,
      labels: null,
      findings: [
        { commit: breaking, subject: "breaks it", file: PY, line: 2, message: `${PY}:2 raises HTTPException` },
      ],
    })
  })

  test("the terminal lists each finding with its commit, and says when there are too few commits", async () => {
    const { root, breaking } = await withHistory()
    const result = await runCli(root, ["test", RULE, "--history"])
    expect(result.stdout).toContain(`${RULE}: new findings in 1 of 2 commits that change its files`)
    expect(result.stdout).toContain(`${breaking.slice(0, 10)} ${PY}:2  ${PY}:2 raises HTTPException`)
    expect(result.stdout).toContain("Only 2 commits: too few for the rate to say how often the rule is broken.")
  })

  test("--commits takes only the newest commits", async () => {
    const { root } = await withHistory()
    const report = json((await runCli(root, ["test", RULE, "--history", "--commits", "1", "--format", "json"])).stdout)
    expect(report.rules[0].history).toMatchObject({ commits: 1, commitsFired: 0, findings: [] })
  })

  test("--label writes the findings to mark, and the marks give a precision", async () => {
    const { root } = await withHistory()
    const first = json((await runCli(root, ["test", RULE, "--history", "--label", "--format", "json"])).stdout)
    const file = path.join(root, ".rulecast/history/backend__no-httpexception.json")
    expect(first.rules[0].history.labels).toMatchObject({ real: 0, false: 0, unlabelled: 1, precision: null })
    const labels = JSON.parse(await readFile(file, "utf8"))
    expect(labels.findings).toHaveLength(1)
    expect(labels.findings[0].label).toBeNull()

    labels.findings[0].label = "real"
    await writeFile(file, JSON.stringify(labels))
    const second = await runCli(root, ["test", RULE, "--history"])
    expect(second.stdout).toContain(
      "marked in .rulecast/history/backend__no-httpexception.json: 1 real, 0 false, 0 not marked: precision 1.00",
    )
    expect(second.stdout).toContain("candidate for the rule's examples.bad")
  })

  test("--max-rate fails a rule that fires in more of enough commits than it allows", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([httpException]), [PY]: "x = 0\n" })
    for (let n = 1; n <= 12; n++) {
      await writeFile(path.join(root, PY), `x = ${n}\n${"raise HTTPException(1)\n".repeat(n % 2)}`)
      await git(root, "commit", "-q", "-am", `change ${n}`)
    }
    const result = await runCli(root, ["test", RULE, "--history", "--max-rate", "0.2", "--format", "json"])
    expect(result.code).toBe(1)
    expect(json(result.stdout).rules[0].history).toMatchObject({ commits: 12, commitsFired: 6, exceeded: true })
  })

  describe("a rule that costs money per file", () => {
    beforeEach(() => vi.stubEnv("PATH", "/usr/bin:/bin"))
    afterEach(() => vi.unstubAllEnvs())

    test("says what it would take and calls nothing, until --yes", async () => {
      const { root } = await withHistory([judgement])
      await stubAgentCli(root, "claude")
      const asked = await runCli(root, ["test", "backend/judgement", "--history", "--format", "json"])
      expect(asked.code).toBe(0)
      expect(json(asked.stdout).rules[0]).toMatchObject({
        status: "not-run",
        history: null,
        estimate: { commits: 2, calls: 2 },
      })
      expect(await readdir(path.join(root, "claude.calls"))).toEqual([])

      const run = await runCli(root, ["test", "backend/judgement", "--history", "--yes", "--format", "json"])
      expect(run.code).toBe(0)
      expect(await readdir(path.join(root, "claude.calls"))).toHaveLength(2)
      expect(json(run.stdout).rules[0].history.commits).toBe(2)
    })
  })

  test("usage errors", async () => {
    const { root } = await withHistory()
    for (const argv of [
      ["test", "--history"],
      ["test", RULE, "--history", "--against", "."],
      ["test", RULE, "--commits", "3"],
      ["test", RULE, "--history", "--commits", "0"],
      ["test", RULE, "--label"],
    ]) {
      const result = await runCli(root, argv)
      expect(result.code, argv.join(" ")).toBe(2)
      expect(result.stdout).toBe("")
    }
  })
})
