import { describe, expect, test } from "vitest"

import { SCHEMA_VERSION } from "../../../src/adapters/cli/contract"
import { exitCodeFor, formatDelivery, type RuleMetadata } from "../../../src/adapters/cli/format"
import { type Delivery, emptyDelivery, type Finding } from "../../../src/core/types"
import { VERSION } from "../../../src/core/version"

const delivery: Delivery = {
  ...emptyDelivery(),
  findings: [
    {
      id: "3f9a1c0b7d2e4a51",
      rule: "backend/x",
      severity: "error",
      status: "new",
      file: "a.py",
      line: 2,
      endLine: 4,
      column: 5,
      message: "bad\nfix it",
      count: 1,
    },
    {
      id: "77ae48826b9bcd8b",
      rule: "front/y",
      severity: "warning",
      status: "new",
      file: "b.ts",
      line: 1,
      endLine: 1,
      column: 1,
      message: "hmm",
      count: 3,
    },
  ],
  preexistingSummary: [{ rule: "backend/x", file: "a.py", count: 4 }],
  references: [
    { ref: "conventions/backend.md#errors", state: "full", content: "## Errors" },
    { ref: "conventions/state.md", state: "read", reason: "mode" },
  ],
  warnings: ["something broke"],
}

const preexisting: Finding = {
  id: "0c4d2e9a8b7f6150",
  rule: "backend/x",
  severity: "error",
  status: "preexisting",
  file: "a.py",
  line: 30,
  endLine: 30,
  column: 1,
  message: "old",
  count: 1,
}

describe("formatDelivery", () => {
  test("terminal: rules that did not run make it incomplete, never clean (#29)", () => {
    const value: Delivery = {
      ...emptyDelivery(),
      warnings: ["x.git@v1: not in the cache"],
      disabled: [{ reason: "x.git@v1: not in the cache", hint: "rulecast install", rules: ["a", "b"] }],
    }
    const text = formatDelivery(value, "terminal", { maxMatchesPerRule: 10 })
    expect(text).toContain("did not run:\n  - 2 rules disabled: x.git@v1: not in the cache (run rulecast install)")
    expect(text).toContain("no findings · incomplete: 2 rules did not run (see above)")
    const config = { ...value, disabled: [{ reason: "the config did not load: bad", rules: [] }] }
    expect(formatDelivery(config, "terminal", { maxMatchesPerRule: 10 })).toContain("incomplete: no rules ran")
  })

  test("terminal", () => {
    expect(formatDelivery(delivery, "terminal", { maxMatchesPerRule: 10 })).toBe(
      [
        "a.py:2:5  error    backend/x  bad fix it",
        "b.ts:1:1  warning  front/y  hmm (×3)",
        "",
        "backlog in the files checked (not from your change):",
        "  backend/x ×4 in a.py",
        "  see all of it: rulecast run --all-files --summary",
        "conventions: conventions/backend.md#errors, conventions/state.md",
        "",
        "rulecast problems:",
        "  - something broke",
        "",
        "findings: 1 error, 1 warning · rulecast: 1 problem (see above)",
      ].join("\n"),
    )
    expect(formatDelivery(emptyDelivery(), "terminal", { maxMatchesPerRule: 10 })).toBe("no findings")
  })

  test("terminal says what it checked, and nothing staged is never 'no findings'", () => {
    const options = { maxMatchesPerRule: 10 }
    const empty = emptyDelivery()
    expect(formatDelivery(empty, "terminal", { ...options, checked: { files: 0, selection: "staged" } })).toBe(
      "nothing staged: 0 files checked (rulecast run --all-files checks everything)",
    )
    expect(formatDelivery(empty, "terminal", { ...options, checked: { files: 3, selection: "staged" } })).toBe(
      "checked 3 staged files\nno findings",
    )
    expect(formatDelivery(empty, "terminal", { ...options, checked: { files: 1, selection: "range" } })).toBe(
      "checked 1 changed file\nno findings",
    )
    expect(formatDelivery(empty, "terminal", { ...options, checked: { files: 194, selection: "all" } })).toBe(
      "checked all 194 files\nno findings",
    )
    expect(formatDelivery(empty, "terminal", { ...options, checked: { files: 2, selection: "files" } })).toBe(
      "checked 2 files\nno findings",
    )
  })

  test("agent uses the shared agent renderer", () => {
    expect(formatDelivery(delivery, "agent", { maxMatchesPerRule: 10 })).toContain(
      "--- conventions/backend.md#errors ---",
    )
  })

  test("json publishes a named, versioned shape, not the whole delivery", () => {
    const parsed = JSON.parse(formatDelivery(delivery, "json", { maxMatchesPerRule: 10 }))
    expect(Object.keys(parsed).sort()).toEqual([
      "backlog",
      "baseline",
      "checked",
      "complete",
      "disabled",
      "findings",
      "ignored",
      "notices",
      "preexisting",
      "preexistingSummary",
      "references",
      "schemaVersion",
      "skipped",
      "stop",
      "touches",
      "warnings",
    ])
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.complete).toBe(true)
    expect(parsed.findings).toEqual(delivery.findings)
    // The id leads, so a reader of the raw output sees what to key on.
    expect(Object.keys(parsed.findings[0])[0]).toBe("id")
    expect(parsed.preexisting).toEqual([])
    expect(parsed.references).toEqual(delivery.references)
    // The renderer's own bookkeeping stays out of the published output.
    expect(parsed).not.toHaveProperty("templates")
    expect(parsed).not.toHaveProperty("omitted")
    expect(parsed).not.toHaveProperty("overflowPath")
  })

  test("json says when the run was incomplete, and lists pre-existing findings and ignores by id", () => {
    const parsed = JSON.parse(
      formatDelivery({ ...delivery, preexisting: [preexisting] }, "json", {
        maxMatchesPerRule: 10,
        complete: false,
        ignored: [{ id: "aa11bb22cc33dd44", rule: "backend/x", file: "a.py", line: 9, reason: "legacy" }],
      }),
    )
    expect(parsed.complete).toBe(false)
    expect(parsed.preexisting).toEqual([preexisting])
    expect(parsed.ignored).toEqual([
      { id: "aa11bb22cc33dd44", rule: "backend/x", file: "a.py", line: 9, reason: "legacy" },
    ])
  })

  test("sarif carries ids, baseline state, end lines and rule help (SARIF 2.1.0)", () => {
    const rules: RuleMetadata[] = [
      {
        id: "backend/x",
        name: "No HTTPException in services",
        description: "Services raise domain exceptions.",
        severity: "error",
        source: "local",
        context: [
          { ref: "conventions/backend.md#errors", content: "## Errors\n\nRaise a domain exception." },
          { ref: "conventions/gone.md", content: null },
        ],
      },
      { id: "front/y", name: "front/y", description: null, severity: "warning", source: "local", context: [] },
    ]
    const sarif = JSON.parse(
      formatDelivery({ ...delivery, preexisting: [preexisting] }, "sarif", { maxMatchesPerRule: 10, rules }),
    )
    expect(sarif.version).toBe("2.1.0")
    const run = sarif.runs[0]
    expect(run.tool.driver).toMatchObject({ name: "rulecast", version: VERSION, informationUri: expect.any(String) })
    expect(run.tool.driver.rules).toEqual([
      {
        id: "backend/x",
        name: "No HTTPException in services",
        shortDescription: { text: "No HTTPException in services" },
        fullDescription: { text: "Services raise domain exceptions." },
        help: {
          text: "conventions/backend.md#errors\n\n## Errors\n\nRaise a domain exception.",
          markdown: "**conventions/backend.md#errors**\n\n## Errors\n\nRaise a domain exception.",
        },
        defaultConfiguration: { level: "error" },
        properties: { context: ["conventions/backend.md#errors", "conventions/gone.md"], source: "local" },
      },
      {
        id: "front/y",
        name: "front/y",
        shortDescription: { text: "front/y" },
        defaultConfiguration: { level: "warning" },
        properties: { context: [], source: "local" },
      },
    ])
    expect(run.results[0]).toEqual({
      ruleId: "backend/x",
      ruleIndex: 0,
      level: "error",
      message: { text: "bad\nfix it" },
      baselineState: "new",
      partialFingerprints: { "rulecastFindingId/v1": "3f9a1c0b7d2e4a51" },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "a.py" },
            region: { startLine: 2, startColumn: 5, endLine: 4 },
          },
        },
      ],
    })
    expect(run.results[1]).toMatchObject({ ruleId: "front/y", ruleIndex: 1, occurrenceCount: 3, baselineState: "new" })
    // Left out, a pre-existing finding would read to code scanning as fixed.
    expect(run.results[2]).toMatchObject({
      ruleId: "backend/x",
      ruleIndex: 0,
      baselineState: "unchanged",
      partialFingerprints: { "rulecastFindingId/v1": preexisting.id },
    })
    expect(run.invocations).toEqual([
      {
        executionSuccessful: true,
        toolExecutionNotifications: [{ level: "warning", message: { text: "something broke" } }],
      },
    ])
  })

  test("sarif help points at the sections when none of them resolve, and is absent without context", () => {
    const rule = (context: RuleMetadata["context"]): RuleMetadata => ({
      id: "backend/x",
      name: "x",
      description: null,
      severity: "error",
      source: "local",
      context,
    })
    const driver = (rules: RuleMetadata[]) =>
      JSON.parse(formatDelivery(delivery, "sarif", { maxMatchesPerRule: 10, rules, complete: false })).runs[0]
    const unresolved = driver([rule([{ ref: "conventions/gone.md", content: null }])])
    expect(unresolved.tool.driver.rules[0].help).toEqual({
      text: "See conventions/gone.md",
      markdown: "See conventions/gone.md",
    })
    expect(unresolved.invocations[0].executionSuccessful).toBe(false)
    expect(driver([rule([])]).tool.driver.rules[0]).not.toHaveProperty("help")
    // Without metadata (a caller that has no compiled rules), ids only.
    expect(driver([]).tool.driver.rules).toEqual([{ id: "backend/x" }, { id: "front/y" }])
  })
})

describe("exitCodeFor", () => {
  test("3 when a rule did not run, even over error findings; 1 for new errors; 0 otherwise", () => {
    expect(exitCodeFor(delivery, false)).toBe(3)
    expect(exitCodeFor({ ...delivery, findings: [] }, false)).toBe(3)
    expect(exitCodeFor(delivery, true)).toBe(1)
    expect(exitCodeFor({ ...delivery, findings: [delivery.findings[1]!] }, true)).toBe(0)
    // Pre-existing errors are the backlog, not this change's violations.
    expect(exitCodeFor({ ...delivery, findings: [], preexisting: [preexisting] }, true)).toBe(0)
  })
})
