import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { writeOverflow } from "../../../src/core/delivery/persist"
import { type Delivery, emptyDelivery } from "../../../src/core/types"

const MESSAGE = "{{file}}:{{line}} returns HTTP {{status}} straight from the service layer. Raise a domain exception."

function delivery(count: number): Delivery {
  return {
    ...emptyDelivery(),
    findings: Array.from({ length: count }, (_, index) => ({
      rule: "backend/no-httpexception",
      severity: "error" as const,
      status: "new" as const,
      file: `app/services/f${index}.py`,
      line: index + 1,
      column: 1,
      message: `app/services/f${index}.py:${index + 1} returns HTTP 404 straight from the service layer.`,
      count: 1,
      captures: { status: "404" },
    })),
    templates: { "backend/no-httpexception": MESSAGE },
    references: [{ ref: "conventions/backend.md#errors", state: "full", content: "## Errors\nRaise your own." }],
  }
}

const stateDir = () => mkdtempSync(path.join(tmpdir(), "rulecast-persist-"))
const at = (minute: number) => new Date(Date.UTC(2026, 8, 23, 12, minute, 0))

describe("writeOverflow", () => {
  test("writes every finding and the sections they cite, with no pointer back to itself", () => {
    const dir = stateDir()
    const file = writeOverflow(dir, "s1", delivery(40), at(1))
    expect(file).not.toBeNull()
    const text = readFileSync(file!, "utf8")
    expect(text).toContain("# rulecast delivery — 2026-09-23T12:01:00.000Z")
    // Past max_matches_per_rule: the file is the copy that holds everything.
    expect(text).toContain("app/services/f39.py:40")
    expect(text).toContain("## Errors")
    expect(text).not.toContain("…and")
    expect(text).not.toContain("did not fit here")
  })

  test("keeps the session's three most recent and no more", () => {
    const dir = stateDir()
    const written = [1, 2, 3, 4, 5].map((minute) => writeOverflow(dir, "s1", delivery(3), at(minute)))
    const left = readdirSync(path.join(dir, "deliveries")).sort()
    expect(left).toHaveLength(3)
    expect(left.map((name) => path.join(dir, "deliveries", name))).toEqual(written.slice(2))
  })

  test("prunes only its own session's files", () => {
    const dir = stateDir()
    for (const minute of [1, 2, 3, 4]) writeOverflow(dir, "s1", delivery(1), at(minute))
    const other = writeOverflow(dir, "s2", delivery(1), at(5))
    const left = readdirSync(path.join(dir, "deliveries"))
    expect(left).toHaveLength(4)
    expect(left).toContain(path.basename(other!))
  })

  test("a directory it cannot write to is not an error: the message is the delivery", () => {
    expect(writeOverflow("/proc/nonexistent/rulecast", "s1", delivery(1), at(1))).toBeNull()
  })

  test("a session id with path separators cannot escape the deliveries directory", () => {
    const dir = stateDir()
    const file = writeOverflow(dir, "../../escape", delivery(1), at(1))
    expect(file).not.toBeNull()
    expect(path.dirname(file!)).toBe(path.join(dir, "deliveries"))
  })
})
