import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { runPipeline } from "../../src/core/pipeline"
import { createFixture, registry } from "../helpers/fixture"
import { git } from "../helpers/git"
import { stateDirFor } from "../helpers/home"

const USERS = "app/services/users.py"

describe("pipeline without a session", () => {
  test("verify on explicit files: everything is new, references are full, no stop decision", async () => {
    const root = await createFixture()
    const { delivery, failed } = await runPipeline({
      root,
      stateDir: stateDirFor(root),
      event: { kind: "verify", files: [USERS, "src/client/api.ts", "README.md"], cwd: root },
      registry,
      maxContextChars: null,
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
    const { delivery } = await runPipeline({
      root,
      stateDir: stateDirFor(root),
      event: { kind: "verify", files: [USERS], baseRef: "main", cwd: root },
      registry,
      maxContextChars: null,
    })
    expect(delivery.findings.map((finding) => finding.line)).toEqual([3])
    expect(delivery.preexistingSummary).toEqual([{ rule: "backend/no-httpexception", file: USERS, count: 1 }])
  })

  test("skipped detector kinds do not run", async () => {
    const root = await createFixture()
    const { delivery } = await runPipeline({
      root,
      stateDir: stateDirFor(root),
      event: { kind: "verify", files: [USERS], cwd: root },
      registry,
      maxContextChars: null,
      skipDetectorKinds: new Set(["regex"]),
    })
    expect(delivery.findings).toEqual([])
  })

  test("compile diagnostics are warnings and mark the run failed", async () => {
    const root = await createFixture()
    await writeFile(
      path.join(root, ".rulecast/rules/broken.yml"),
      "id: broken\nfiles: '**'\ndetect: { nope: {} }\nmessage: m\n",
    )
    const { delivery, failed } = await runPipeline({
      root,
      stateDir: stateDirFor(root),
      event: { kind: "verify", files: [USERS], cwd: root },
      registry,
      maxContextChars: null,
    })
    expect(failed).toBe(true)
    expect(delivery.warnings).toEqual(['.rulecast/rules/broken.yml: unknown detector "nope" (run rulecast validate)'])
    expect(delivery.findings).toHaveLength(1)
  })
})
