import { describe, expect, test } from "vitest"

import { renderAgentText } from "../../../src/core/delivery/render-agent"
import { type Delivery, emptyDelivery, type Finding } from "../../../src/core/types"

const HTTP =
  "{{file}}:{{line}} returns HTTP {{status}} ({{detail}}) straight from the service layer. Raise a domain exception."
const GENERATED = "{{file}} is generated from openapi.yaml. Edit the schema and run `pnpm codegen` instead."

const finding = (file: string, line: number, captures?: Record<string, string>, overrides: Partial<Finding> = {}) =>
  ({
    rule: "backend/no-httpexception",
    severity: "error",
    status: "new",
    file,
    line,
    column: 1,
    message: `${file}:${line} returns HTTP ${captures?.status} (${captures?.detail}) straight from the service layer. Raise a domain exception.`,
    count: 1,
    captures,
    ...overrides,
  }) satisfies Finding

const delivery = (findings: Finding[], templates: Record<string, string>, over: Partial<Delivery> = {}): Delivery => ({
  ...emptyDelivery(),
  findings,
  templates,
  ...over,
})

const render = (value: Delivery, maxMatchesPerRule = 10) => renderAgentText(value, { maxMatchesPerRule })

describe("renderAgentText: grouping", () => {
  test("prints the message once and lists each site's captures under it", () => {
    const text = render(
      delivery(
        [
          finding("app/services/users.py", 6, { status: "404", detail: '"users not found"' }),
          finding("app/services/users.py", 8, { status: "422", detail: '"users must be positive"' }),
          finding("app/services/billing.py", 6, { status: "409", detail: '"already charged"' }),
        ],
        { "backend/no-httpexception": HTTP },
      ),
    )
    expect(text).toBe(
      [
        "rulecast: 1 rule violated",
        "",
        "error backend/no-httpexception — 3 in 2 files",
        "  {file}:{line} returns HTTP {status} ({detail}) straight from the service layer. Raise a domain exception.",
        "",
        '  app/services/users.py:6    404  "users not found"',
        '  app/services/users.py:8    422  "users must be positive"',
        '  app/services/billing.py:6  409  "already charged"',
      ].join("\n"),
    )
  })

  test("a message with nothing to vary per site packs the locations, without a line number", () => {
    const paths = ["src/client/api.ts", "src/client/types.ts", "src/client/hooks.ts"].map((file) =>
      finding(file, 1, undefined, {
        rule: "codegen/no-edit-client",
        message: `${file} is generated from openapi.yaml. Edit the schema and run \`pnpm codegen\` instead.`,
      }),
    )
    expect(render(delivery(paths, { "codegen/no-edit-client": GENERATED }))).toBe(
      [
        "rulecast: 1 rule violated",
        "",
        "error codegen/no-edit-client — 3 in 3 files",
        "  {file} is generated from openapi.yaml. Edit the schema and run `pnpm codegen` instead.",
        "",
        "  src/client/api.ts, src/client/types.ts, src/client/hooks.ts",
      ].join("\n"),
    )
  })

  test("two findings stay ungrouped: the skeleton costs more than the repeat saves", () => {
    const text = render(
      delivery(
        [finding("a.py", 6, { status: "404", detail: '"a"' }), finding("b.py", 8, { status: "422", detail: '"b"' })],
        { "backend/no-httpexception": HTTP },
      ),
    )
    expect(text).toContain("error backend/no-httpexception\n")
    expect(text).not.toContain("{file}")
    expect(text).toContain('a.py:6 returns HTTP 404 ("a")')
  })

  test("a template that is all variables stays ungrouped: there is no prose to factor out", () => {
    const passthrough = "{{file}}:{{line}} {{text}}"
    const findings = ["a.py", "b.py", "c.py"].map((file) =>
      finding(file, 2, { text: "unused import os" }, { rule: "py/ruff", message: `${file}:2 unused import os` }),
    )
    expect(render(delivery(findings, { "py/ruff": passthrough }))).toContain("error py/ruff\n")
  })

  test("findings with no template — a rule repo's own wording — are never grouped", () => {
    const findings = ["a.py", "b.py", "c.py"].map((file) =>
      finding(file, 2, { status: "404", detail: '"x"' }, { rule: "other/rule" }),
    )
    expect(render(delivery(findings, {}))).toContain("error other/rule\n")
  })

  test("merged duplicates keep their count, and the renderer's cap reports the rest", () => {
    const findings = [
      finding("a.py", 6, { status: "404", detail: '"a"' }, { count: 3 }),
      finding("b.py", 6, { status: "404", detail: '"b"' }),
      finding("c.py", 6, { status: "404", detail: '"c"' }),
    ]
    const text = render(delivery(findings, { "backend/no-httpexception": HTTP }), 2)
    expect(text).toContain('a.py:6  404  "a" (×3)')
    expect(text).toContain("…and 1 more in 1 file")
    expect(text).not.toContain("c.py")
  })

  test("what the budget dropped is counted in the header and the tail", () => {
    const findings = [
      finding("a.py", 6, { status: "404", detail: '"a"' }),
      finding("a.py", 9, { status: "404", detail: '"a2"' }),
    ]
    const text = render(
      delivery(
        findings,
        { "backend/no-httpexception": HTTP },
        {
          omitted: { findings: [{ rule: "backend/no-httpexception", count: 7, files: 4 }], rules: 0, preexisting: 0 },
        },
      ),
    )
    expect(text).toContain("error backend/no-httpexception — 9 in 5 files")
    expect(text).toContain("…and 7 more in 4 files")
  })
})

describe("renderAgentText: overflow", () => {
  test("points at the file the whole delivery was written to", () => {
    const text = render(
      delivery(
        [finding("a.py", 6, { status: "404", detail: '"a"' })],
        { "backend/no-httpexception": HTTP },
        {
          omitted: { findings: [], rules: 4, preexisting: 2 },
          overflowPath: "/cache/projects/ab12/deliveries/s1-2026-09-23.md",
        },
      ),
    )
    expect(text).toContain("rulecast: 5 rules violated")
    expect(text).toContain("…and 2 more pre-existing (not blocking)")
    expect(text).toContain("…4 rules and the conventions they cite did not fit here.")
    expect(text).toContain("  /cache/projects/ab12/deliveries/s1-2026-09-23.md")
  })
})
