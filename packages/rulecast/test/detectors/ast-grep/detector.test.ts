import { describe, expect, test } from "vitest"

import { memoryCache } from "../../../src/core/detection/cache"
import { type DetectorRuleInput, defaultDetectorSettings } from "../../../src/core/types"
import { astGrepDetector } from "../../../src/detectors/ast-grep/detector"
import type { AstGrepConfig } from "../../../src/detectors/ast-grep/schema"
import { createProject, fromDisk } from "../../helpers/project"

async function ruleFor(id: string, config: unknown, files: string[]): Promise<DetectorRuleInput<AstGrepConfig>> {
  const parsed = await astGrepDetector.schema.parseAsync(config)
  return { id, config: parsed, files, context: [] }
}

const run = async (cwd: string, rules: DetectorRuleInput<AstGrepConfig>[], signal = new AbortController().signal) =>
  astGrepDetector.run({
    event: "edit",
    rules,
    changes: new Map(),
    read: fromDisk(cwd),
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd,
    signal,
    deadlineAt: Date.now() + 60_000,
  })

const PY =
  "def get(id):\n    if not id:\n        raise HTTPException(404, detail='missing')\n    raise HTTPException(403)\n"
const TSX = 'const a = <div style={{ padding: 8, color: "r" }} id="x"/>\n'

describe("ast-grep detector", () => {
  test("declares events and captures", async () => {
    const config = await astGrepDetector.schema.parseAsync({
      language: "python",
      rule: { pattern: "raise HTTPException($$$ARGS)" },
    })
    expect(astGrepDetector.kind).toBe("ast-grep")
    expect(astGrepDetector.events(config)).toEqual(["edit", "verify"])
    expect(astGrepDetector.captures(config)).toEqual(["ARGS"])
  })

  test("reports every match with 1-based positions and multi-node captures joined", async () => {
    const cwd = await createProject({ "app/services/users.py": PY })
    const result = await run(cwd, [
      await ruleFor("no-httpexception", { language: "python", rule: { pattern: "raise HTTPException($$$ARGS)" } }, [
        "app/services/users.py",
        "app/services/gone.py",
      ]),
    ])
    expect(result.errors).toEqual([])
    expect(result.findings).toEqual([
      {
        rule: "no-httpexception",
        match: {
          file: "app/services/users.py",
          line: 3,
          endLine: 3,
          column: 9,
          text: "raise HTTPException(404, detail='missing')",
          captures: { ARGS: "404, detail='missing'" },
        },
      },
      {
        rule: "no-httpexception",
        match: {
          file: "app/services/users.py",
          line: 4,
          endLine: 4,
          column: 5,
          text: "raise HTTPException(403)",
          captures: { ARGS: "403" },
        },
      },
    ])
  })

  test("a single metavariable captures one node; an unmatched one is empty", async () => {
    const cwd = await createProject({ "a.py": "f(1)\ng()\n" })
    const result = await run(cwd, [
      await ruleFor("one", { language: "python", rule: { any: [{ pattern: "f($A)" }, { pattern: "g()" }] } }, ["a.py"]),
    ])
    expect(result.errors).toEqual([])
    expect(result.findings.map((finding) => finding.match.captures)).toEqual([{ A: "1" }, { A: "" }])
  })

  test("runs every rule of a language against one parse, and keeps languages apart", async () => {
    const cwd = await createProject({ "a.py": PY, "b.tsx": TSX })
    const result = await run(cwd, [
      await ruleFor("py-raise", { language: "python", rule: { pattern: "raise HTTPException($$$ARGS)" } }, ["a.py"]),
      await ruleFor("py-if", { language: "python", rule: { kind: "if_statement" } }, ["a.py"]),
      await ruleFor(
        "tsx-style",
        { language: "tsx", rule: { pattern: { context: "<div style={{ $$$PROPS }}/>", selector: "jsx_attribute" } } },
        ["b.tsx"],
      ),
    ])
    expect(result.errors).toEqual([])
    expect(result.findings.filter((finding) => finding.rule === "py-raise")).toHaveLength(2)
    expect(result.findings.filter((finding) => finding.rule === "py-if")).toHaveLength(1)
    const style = result.findings.find((finding) => finding.rule === "tsx-style")!
    expect(style.match.text).toBe('style={{ padding: 8, color: "r" }}')
    expect(style.match.captures).toEqual({ PROPS: 'padding: 8, color: "r"' })
  })

  test("a file that no longer exists is skipped, not an error", async () => {
    const cwd = await createProject({ "a.py": "x = 1\n" })
    const result = await run(cwd, [await ruleFor("r", { language: "python", rule: { kind: "module" } }, ["gone.py"])])
    expect(result).toEqual({ findings: [], errors: [] })
  })

  test("an unparseable file still parses: tree-sitter recovers, so it reports what it can", async () => {
    const cwd = await createProject({ "a.py": "def (:\n    raise HTTPException(1)\n" })
    const result = await run(cwd, [
      await ruleFor("r", { language: "python", rule: { pattern: "raise HTTPException($$$A)" } }, ["a.py"]),
    ])
    expect(result.errors).toEqual([])
    expect(result.findings).toHaveLength(1)
  })

  test("no rules is an empty result and never loads the parser", async () => {
    const cwd = await createProject({})
    expect(await run(cwd, [])).toEqual({ findings: [], errors: [] })
  })

  test("an aborted run throws so the core can mark it timed out", async () => {
    const cwd = await createProject({ "a.py": PY })
    const controller = new AbortController()
    controller.abort()
    await expect(
      run(cwd, [await ruleFor("r", { language: "python", rule: { kind: "module" } }, ["a.py"])], controller.signal),
    ).rejects.toThrow()
  })
})
