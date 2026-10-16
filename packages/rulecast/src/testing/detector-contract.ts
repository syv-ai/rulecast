import assert from "node:assert/strict"

import { memoryCache } from "../core/detection/cache"
import { readSourceFile } from "../core/detection/per-rule"
import type { AnyDetector } from "../core/detection/registry"
import { type DetectorEvent, type DetectorResult, defaultDetectorSettings } from "../core/types"
import { type ContractCase, contractProject } from "./contract"

export interface DetectorFixture {
  /** Files the project needs, repo-relative. */
  files: Record<string, string>
  /** Anything the project needs beyond files — a binary in node_modules/.bin, say. */
  prepare?(root: string): Promise<void>
  /** A detect config that matches at least once in `matching`. */
  config: unknown
  /** The files the matching config selects. */
  matching: string[]
  /**
   * A config the schema accepts but that fails at run time, to check that one rule's failure
   * leaves the others alone. Omit it and that case is skipped.
   */
  failing?: { config: unknown; matching?: string[] }
  /**
   * For a detector that declares `fixable`: a config with a fix that matches at least once in
   * `matching`, and whose fix removes every match. Omit it and the fix cases are skipped.
   */
  fix?: { config: unknown }
}

const EVENTS: DetectorEvent[] = ["edit", "verify"]

async function configOf(detector: AnyDetector, value: unknown, where: string): Promise<unknown> {
  const parsed = await detector.schema.safeParseAsync(value)
  assert.ok(parsed.success, `${where} config must pass the detector's own schema`)
  return parsed.data
}

function run(
  detector: AnyDetector,
  rules: unknown[],
  cwd: string,
  signal: AbortSignal,
  options: { fixes?: boolean; read?: (file: string) => Promise<string | null> } = {},
): Promise<DetectorResult> {
  return detector.run({
    event: "edit",
    // biome-ignore lint/suspicious/noExplicitAny: the registry erases each detector's config type.
    rules: rules as any,
    changes: new Map(),
    read: options.read ?? ((file) => readSourceFile(cwd, file)),
    ...(options.fixes === true ? { fixes: true } : {}),
    cache: memoryCache(),
    settings: defaultDetectorSettings(),
    cwd,
    signal,
    // The contract suite is not measuring the clock; a deadline far ahead keeps it out of the way.
    deadlineAt: Date.now() + 60_000,
  })
}

function assertResultShape(result: DetectorResult, ids: string[]): void {
  assert.ok(Array.isArray(result.findings), "result.findings must be an array")
  assert.ok(Array.isArray(result.errors), "result.errors must be an array")
  for (const finding of result.findings) {
    assert.ok(ids.includes(finding.rule), `finding names rule "${finding.rule}", which was not in the run`)
    const { match } = finding
    assert.equal(typeof match.file, "string", "match.file must be a string")
    for (const key of ["line", "endLine", "column"] as const) {
      assert.ok(Number.isInteger(match[key]) && match[key] >= 1, `match.${key} must be a 1-based integer`)
    }
    assert.ok(match.endLine >= match.line, "match.endLine must not precede match.line")
    assert.equal(typeof match.text, "string", "match.text must be a string")
  }
  for (const error of result.errors) {
    assert.ok(error.rule === null || ids.includes(error.rule), `error names rule "${error.rule}", not in the run`)
    assert.equal(typeof error.message, "string", "error.message must be a string")
  }
}

/**
 * The detector contract of spec §6, as cases any test runner can drive:
 *
 *   for (const testCase of detectorContract(myDetector, myFixture)) test(testCase.name, testCase.run)
 *
 * The cases throw node:assert errors, so nothing here depends on a test framework.
 */
export function detectorContract(detector: AnyDetector, fixture: DetectorFixture): ContractCase[] {
  const project = async () => {
    const root = await contractProject(fixture.files)
    await fixture.prepare?.(root)
    return root
  }
  const rule = (id: string, config: unknown, files: string[]) => ({ id, config, files, context: [] })
  const open = () => new AbortController().signal

  const cases: ContractCase[] = [
    {
      name: "declares a kind, captures and events",
      async run() {
        assert.ok(detector.kind.length > 0, "kind must not be empty")
        const config = await configOf(detector, fixture.config, "the fixture's")
        const captures = detector.captures(config)
        assert.ok(Array.isArray(captures), "captures(config) must return an array")
        for (const name of captures) assert.equal(typeof name, "string", "a capture name must be a string")
        const events = detector.events(config)
        assert.ok(events.length > 0, "events(config) must name at least one event")
        for (const event of events) assert.ok(EVENTS.includes(event), `unknown event "${event}"`)
      },
    },
    {
      name: "no rules is an empty result",
      async run() {
        const result = await run(detector, [], await project(), open())
        assert.deepEqual(result, { findings: [], errors: [] })
      },
    },
    {
      name: "every match carries exactly the declared captures, as strings",
      async run() {
        const config = await configOf(detector, fixture.config, "the fixture's")
        const declared = [...detector.captures(config)].sort()
        const result = await run(detector, [rule("a", config, fixture.matching)], await project(), open())
        assert.deepEqual(result.errors, [], "the fixture's matching config must not error")
        assert.ok(result.findings.length > 0, "the fixture's matching config must produce at least one finding")
        assertResultShape(result, ["a"])
        for (const finding of result.findings) {
          const present = Object.keys(finding.match.captures).sort()
          assert.deepEqual(present, declared, "captures must be exactly the declared names")
          for (const value of Object.values(finding.match.captures)) {
            assert.equal(typeof value, "string", "every capture must be a string")
          }
        }
      },
    },
    {
      name: "batching attributes the same work to every rule that asked for it",
      async run() {
        const config = await configOf(detector, fixture.config, "the fixture's")
        const rules = [rule("a", config, fixture.matching), rule("b", config, fixture.matching)]
        const result = await run(detector, rules, await project(), open())
        assert.deepEqual(result.errors, [], "two identical rules must not error")
        assertResultShape(result, ["a", "b"])
        const forRule = (id: string) => result.findings.filter((finding) => finding.rule === id)
        assert.ok(forRule("a").length > 0, "rule a must get findings")
        assert.equal(forRule("b").length, forRule("a").length, "identical rules must get the same findings")
      },
    },
    {
      name: "an aborted run produces nothing",
      async run() {
        const config = await configOf(detector, fixture.config, "the fixture's")
        const controller = new AbortController()
        controller.abort()
        const rules = [rule("a", config, fixture.matching)]
        const result = await run(detector, rules, await project(), controller.signal).catch(() => null)
        // Either the run threw (the core marks it timed out) or it returned without findings.
        if (result !== null) assert.deepEqual(result.findings, [], "an aborted run must not report findings")
      },
    },
  ]

  if (fixture.failing) {
    const failing = fixture.failing
    cases.push({
      name: "a rule that fails does not take the others with it",
      async run() {
        const good = await configOf(detector, fixture.config, "the fixture's")
        const bad = await configOf(detector, failing.config, "the fixture's failing")
        const rules = [rule("bad", bad, failing.matching ?? fixture.matching), rule("good", good, fixture.matching)]
        const result = await run(detector, rules, await project(), open())
        assertResultShape(result, ["bad", "good"])
        assert.ok(
          result.errors.some((error) => error.rule === "bad"),
          "the failing rule must produce an error naming it",
        )
        assert.ok(
          !result.errors.some((error) => error.rule === null),
          "one rule's failure must not be reported as a whole-run error",
        )
        assert.ok(
          result.findings.some((finding) => finding.rule === "good"),
          "the healthy rule must still report its findings",
        )
      },
    })
  }

  if (fixture.fix) {
    const fix = fixture.fix
    const fixedRule = async () => rule("a", await configOf(detector, fix.config, "the fixture's fix"), fixture.matching)
    cases.push(
      {
        name: "declares the fix config fixable",
        async run() {
          assert.ok(detector.fixable !== undefined, "a fixture with a fix needs a detector that declares fixable")
          const config = await configOf(detector, fix.config, "the fixture's fix")
          assert.equal(detector.fixable(config), true, "fixable(config) must be true for the fixture's fix config")
          const plain = await configOf(detector, fixture.config, "the fixture's")
          assert.equal(detector.fixable(plain), false, "fixable(config) must be false for a config without a fix")
        },
      },
      {
        name: "findings carry no fix unless the run asks for fixes",
        async run() {
          const result = await run(detector, [await fixedRule()], await project(), open())
          assert.ok(result.findings.length > 0, "the fixture's fix config must produce at least one finding")
          for (const finding of result.findings) assert.equal(finding.fix, undefined, "a fix was attached unasked")
        },
      },
      {
        name: "a fix is an edit inside the text the detector read",
        async run() {
          const root = await project()
          const result = await run(detector, [await fixedRule()], root, open(), { fixes: true })
          assert.ok(result.findings.length > 0, "the fixture's fix config must produce at least one finding")
          for (const { match, fix: edit } of result.findings) {
            assert.ok(edit !== undefined, "with fixes, every finding of a rule with a fix carries one")
            const text = (await readSourceFile(root, match.file)) ?? ""
            assert.ok(Number.isInteger(edit.start) && Number.isInteger(edit.end), "edit offsets must be integers")
            assert.ok(
              0 <= edit.start && edit.start <= edit.end && edit.end <= text.length,
              "edit must lie inside the text",
            )
            assert.equal(typeof edit.text, "string", "edit.text must be a string")
          }
        },
      },
      {
        name: "applying the fixes removes the rule's matches",
        async run() {
          const root = await project()
          const fixed = await fixedRule()
          const result = await run(detector, [fixed], root, open(), { fixes: true })
          const texts = new Map<string, string>()
          for (const file of fixture.matching) {
            let text = (await readSourceFile(root, file)) ?? ""
            const edits = result.findings
              .filter((finding) => finding.match.file === file && finding.fix !== undefined)
              .map((finding) => finding.fix!)
              .sort((a, b) => b.start - a.start)
            for (const edit of edits) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
            texts.set(file, text)
          }
          const again = await run(detector, [fixed], root, open(), { read: async (file) => texts.get(file) ?? null })
          assert.deepEqual(again.findings, [], "the fixed text must not match the rule again")
        },
      },
    )
  }

  return cases
}
