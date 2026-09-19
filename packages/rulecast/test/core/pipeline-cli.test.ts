import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { stringify } from "yaml"

import { localConfig } from "../helpers/config"
import { createFixture, fixtureRules } from "../helpers/fixture"
import { git } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

const USERS = "app/services/users.py"

describe("pipeline without a session", () => {
  test("verify on explicit files: everything is new, references are full, no stop decision", async () => {
    const root = await createFixture()
    const { delivery, failed } = await pipelineAt(root, {
      kind: "verify",
      files: [USERS, "src/client/api.ts", "README.md"],
      cwd: root,
    })
    expect(failed).toBe(false)
    expect(delivery.stop).toBeNull()
    expect(delivery.findings.map((finding) => [finding.rule, finding.severity, finding.line])).toEqual([
      ["backend/no-httpexception", "error", 2],
      ["frontend/no-generated-edits", "warning", 1],
    ])
    expect(delivery.references.map((reference) => [reference.ref, reference.state])).toEqual([
      ["conventions/backend.md#errors", "full"],
    ])
  })

  test("verify with a base ref classifies against the merge base", async () => {
    const root = await createFixture()
    await git(root, "checkout", "-q", "-b", "feature")
    await writeFile(path.join(root, USERS), "def get():\n    raise HTTPException(404)\n    raise HTTPException(500)\n")
    const { delivery } = await pipelineAt(root, { kind: "verify", files: [USERS], baseRef: "main", cwd: root })
    expect(delivery.findings.map((finding) => finding.line)).toEqual([3])
    expect(delivery.preexistingSummary).toEqual([{ rule: "backend/no-httpexception", file: USERS, count: 1 }])
  })

  test("skipped detector kinds do not run", async () => {
    const root = await createFixture()
    const { delivery } = await pipelineAt(
      root,
      { kind: "verify", files: [USERS], cwd: root },
      { skipDetectorKinds: new Set(["regex"]) },
    )
    expect(delivery.findings).toEqual([])
  })

  test("compile errors are warnings and mark the run failed; compile warnings are not", async () => {
    const root = await createFixture()
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      localConfig([...fixtureRules, { id: "broken", name: "Broken", detect: { nope: {} }, message: "m" }]),
    )
    const { delivery, failed } = await pipelineAt(root, { kind: "verify", files: [USERS], cwd: root })
    expect(failed).toBe(true)
    expect(delivery.warnings).toEqual([
      '.rulecast-config.yaml (broken): unknown detector "nope" (run rulecast validate)',
    ])
    expect(delivery.findings).toHaveLength(1)
  })

  test("a rule repo missing from the cache names rulecast install", async () => {
    const root = await createFixture()
    await writeFile(
      path.join(root, ".rulecast-config.yaml"),
      stringify({
        repos: [
          { repo: "local", rules: fixtureRules },
          { repo: "https://example.com/acme/rules", rev: "v1.0.0", rules: [{ id: "x" }] },
        ],
      }),
    )
    const { delivery, failed } = await pipelineAt(root, { kind: "verify", files: [USERS], cwd: root })
    expect(failed).toBe(true)
    expect(delivery.warnings).toEqual([
      "https://example.com/acme/rules@v1.0.0: not in the cache (run rulecast install)",
    ])
    expect(delivery.findings).toHaveLength(1)
  })
})
