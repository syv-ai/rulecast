import { describe, expect, test } from "vitest"

import type { Event, WriteIntent } from "../../src/core/types"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

const SERVICE = "app/services/users.py"
const CLIENT = "src/client/api.ts"

const RULES = [
  {
    id: "backend/no-httpexception",
    name: "Services raise domain exceptions",
    files: "^app/services/.*\\.py$",
    detect: { regex: { pattern: "raise HTTPException\\((?<args>[^)]*)\\)" } },
    refuse_write: true,
    message: "{{file}}:{{line}} raises HTTPException({{args}}). Raise a domain exception.",
    context: ["@conventions/backend.md#errors"],
  },
  {
    id: "codegen/no-edit-client",
    name: "Generated client",
    files: "^src/client/",
    detect: { path: {} },
    refuse_write: true,
    message: "{{file}} is generated. Change the schema instead.",
  },
  {
    id: "style/quiet",
    name: "A rule that only reports",
    files: "^app/services/.*\\.py$",
    detect: { regex: { pattern: "print\\(" } },
    message: "{{file}}:{{line}} prints. Use the logger.",
  },
]

const files = {
  ".rulecast-config.yaml": localConfig(RULES),
  "conventions/backend.md": "# Backend\n## Errors\nServices raise domain exceptions.\n",
  [SERVICE]: "def get(x):\n    return x\n",
  [CLIENT]: "export const api = 1\n",
}

const guard = (root: string, file: string, intent: WriteIntent, session = "s1"): Event => ({
  kind: "guard",
  files: [file],
  cwd: root,
  session: { id: session },
  intent,
})

const run = async (root: string, event: Event) => (await pipelineAt(root, event, { maxContextChars: 9000 })).delivery

describe("pipeline: guarding a write", () => {
  test("refuses a write whose own text breaks a refusing rule, with the section that explains it", async () => {
    const root = await createRepo(files)
    const delivery = await run(
      root,
      guard(root, SERVICE, { edit: { find: "return x", replace: 'raise HTTPException(404, "nope")', all: false } }),
    )
    expect(delivery.findings.map((finding) => finding.rule)).toEqual(["backend/no-httpexception"])
    expect(delivery.findings[0]!.message).toContain("Raise a domain exception")
    expect(delivery.references).toEqual([
      { ref: "conventions/backend.md#errors", state: "full", content: "## Errors\nServices raise domain exceptions." },
    ])
  })

  test("a whole-file write is judged on the content the tool carries", async () => {
    const root = await createRepo(files)
    const delivery = await run(root, guard(root, SERVICE, { content: "def get(x):\n    raise HTTPException(500)\n" }))
    expect(delivery.findings.map((finding) => finding.rule)).toEqual(["backend/no-httpexception"])
  })

  test("a path rule refuses the write whatever the content is", async () => {
    const root = await createRepo(files)
    const delivery = await run(root, guard(root, CLIENT, { content: "export const api = 2\n" }))
    expect(delivery.findings.map((finding) => finding.rule)).toEqual(["codegen/no-edit-client"])
  })

  describe("allows the write", () => {
    test("when the violation is elsewhere in the file and the edit did not add it", async () => {
      const root = await createRepo({
        ...files,
        [SERVICE]: "def get(x):\n    raise HTTPException(404)\n    return x\n",
      })
      const delivery = await run(
        root,
        guard(root, SERVICE, { edit: { find: "return x", replace: "return x + 1", all: false } }),
      )
      expect(delivery.findings).toEqual([])
    })

    test("when old_string is not in the file, so the result cannot be known", async () => {
      const root = await createRepo(files)
      const delivery = await run(
        root,
        guard(root, SERVICE, { edit: { find: "not here", replace: "raise HTTPException(404)", all: false } }),
      )
      expect(delivery.findings).toEqual([])
    })

    test("when old_string is ambiguous without replace_all", async () => {
      const root = await createRepo({ ...files, [SERVICE]: "pass\npass\n" })
      const delivery = await run(
        root,
        guard(root, SERVICE, { edit: { find: "pass", replace: "raise HTTPException(404)", all: false } }),
      )
      expect(delivery.findings).toEqual([])
    })

    test("when the rule does not ask to refuse", async () => {
      const root = await createRepo(files)
      const delivery = await run(
        root,
        guard(root, SERVICE, { edit: { find: "return x", replace: 'print("x")', all: false } }),
      )
      expect(delivery.findings).toEqual([])
    })

    test("the second time, so a refusal cannot become a loop", async () => {
      const root = await createRepo(files)
      const attempt = () =>
        run(root, guard(root, SERVICE, { edit: { find: "return x", replace: "raise HTTPException(404)", all: false } }))
      expect((await attempt()).findings).toHaveLength(1)
      expect((await attempt()).findings).toEqual([])
    })

    test("but refuses the same rule again in a different session", async () => {
      const root = await createRepo(files)
      const intent: WriteIntent = { edit: { find: "return x", replace: "raise HTTPException(404)", all: false } }
      expect((await run(root, guard(root, SERVICE, intent, "s1"))).findings).toHaveLength(1)
      expect((await run(root, guard(root, SERVICE, intent, "s2"))).findings).toHaveLength(1)
    })
  })

  test("guarding leaves no trace for the edit hook: no baseline, no session context", async () => {
    const root = await createRepo(files)
    await run(
      root,
      guard(root, SERVICE, { edit: { find: "return x", replace: "raise HTTPException(404)", all: false } }),
    )
    // The file still has no violation, and the write never happened, so an edit event on it now
    // reports nothing at all rather than a finding the guard already talked about.
    const after = (await pipelineAt(root, { kind: "edit", files: [SERVICE], cwd: root, session: { id: "s1" } }))
      .delivery
    expect(after.findings).toEqual([])
  })
})
