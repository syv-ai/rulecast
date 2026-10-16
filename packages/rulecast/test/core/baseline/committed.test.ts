import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import {
  BASELINE_FILE,
  BaselineFileError,
  baselineHas,
  buildBaseline,
  type CommittedBaseline,
  type EntryVerdict,
  entryVerdict,
  pruneBaseline,
  readCommittedBaseline,
  serialiseBaseline,
  writeCommittedBaseline,
} from "../../../src/core/baseline/committed"
import { FINDING_ID_VERSION } from "../../../src/core/finding-id"
import { VERSION } from "../../../src/core/version"
import { createProject } from "../../helpers/project"

const id = (n: number) => n.toString(16).padStart(16, "0")

const entries = (baseline: CommittedBaseline) =>
  [...baseline.rules].flatMap(([rule, files]) =>
    [...files].flatMap(([file, ids]) => [...ids].map((value) => `${rule} ${file} ${value}`)),
  )

describe("the committed baseline file", () => {
  test("is written sorted by code unit, with counts, a total and a trailing newline", () => {
    const baseline = buildBaseline([
      { id: id(3), rule: "b/rule", file: "z.py" },
      { id: id(2), rule: "b/rule", file: "a.py" },
      { id: id(1), rule: "b/rule", file: "a.py" },
      { id: id(9), rule: "B/upper", file: "x.py" },
      { id: id(4), rule: "a/rule", file: "a.py" },
    ])
    const text = serialiseBaseline(baseline)
    expect(text.endsWith("}\n")).toBe(true)
    const document = JSON.parse(text)
    expect(document).toMatchObject({ version: 1, findingIdVersion: FINDING_ID_VERSION, rulecast: VERSION, total: 5 })
    expect(Object.keys(document.rules)).toEqual(["B/upper", "a/rule", "b/rule"])
    expect(document.rules["b/rule"]).toEqual({ count: 3, files: { "a.py": [id(1), id(2)], "z.py": [id(3)] } })
    // The same findings in another order are the same bytes.
    const shuffled = buildBaseline([
      { id: id(4), rule: "a/rule", file: "a.py" },
      { id: id(1), rule: "b/rule", file: "a.py" },
      { id: id(9), rule: "B/upper", file: "x.py" },
      { id: id(3), rule: "b/rule", file: "z.py" },
      { id: id(2), rule: "b/rule", file: "a.py" },
    ])
    expect(serialiseBaseline(shuffled)).toBe(text)
  })

  test("reads back what it wrote", async () => {
    const root = await createProject({})
    const baseline = buildBaseline([{ id: id(1), rule: "r", file: "a.py" }])
    await writeCommittedBaseline(root, baseline)
    const read = await readCommittedBaseline(root)
    expect(read).not.toBeNull()
    expect(baselineHas(read!, "r", "a.py", id(1))).toBe(true)
    expect(baselineHas(read!, "r", "b.py", id(1))).toBe(false)
    expect(serialiseBaseline(read!)).toBe(serialiseBaseline(baseline))
  })

  test("is null when absent, and an error naming the file and the fix when malformed", async () => {
    const root = await createProject({})
    expect(await readCommittedBaseline(root)).toBeNull()
    await mkdir(path.join(root, ".rulecast"), { recursive: true })
    await writeFile(path.join(root, BASELINE_FILE), "{ not json")
    await expect(readCommittedBaseline(root)).rejects.toThrow(BaselineFileError)
    await expect(readCommittedBaseline(root)).rejects.toThrow(
      /^\.rulecast\/baseline\.json: not JSON.*rulecast baseline --force/,
    )
    await writeFile(
      path.join(root, BASELINE_FILE),
      JSON.stringify({
        version: 1,
        findingIdVersion: 1,
        rulecast: "0",
        total: 1,
        rules: { r: { count: 1, files: { "a.py": ["xyz"] } } },
      }),
    )
    await expect(readCommittedBaseline(root)).rejects.toThrow(/rules\.r\.files\.a\.py\.0: not a finding id/)
  })
})

describe("pruning", () => {
  const baseline = buildBaseline([
    { id: id(1), rule: "r", file: "a.py" },
    { id: id(2), rule: "r", file: "a.py" },
    { id: id(3), rule: "r", file: "b.py" },
    { id: id(4), rule: "s", file: "a.py" },
  ])

  test("drops what a checked file no longer has, everything gone, and keeps what was not checked", () => {
    const verdicts: Record<string, EntryVerdict> = { "r a.py": "checked", "r b.py": "unchecked", "s a.py": "gone" }
    const { next, removed } = pruneBaseline(
      baseline,
      new Set([id(1), id(4)]),
      (rule, file) => verdicts[`${rule} ${file}`]!,
    )
    expect(entries(next)).toEqual([`r a.py ${id(1)}`, `r b.py ${id(3)}`])
    expect(removed).toEqual([
      { rule: "r", file: "a.py", id: id(2) },
      { rule: "s", file: "a.py", id: id(4) },
    ])
  })

  test("only ever returns a subset of what it was given, whatever was found", () => {
    // Property-style: random baselines, random found sets that include ids the baseline never had.
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const states: EntryVerdict[] = ["checked", "gone", "unchecked"]
    for (let round = 0; round < 200; round++) {
      const findings = Array.from({ length: Math.floor(random() * 12) }, () => ({
        id: id(Math.floor(random() * 40)),
        rule: `r${Math.floor(random() * 3)}`,
        file: `f${Math.floor(random() * 3)}.py`,
      }))
      const old = buildBaseline(findings)
      const found = new Set(Array.from({ length: Math.floor(random() * 20) }, () => id(Math.floor(random() * 60))))
      const verdict = new Map<string, EntryVerdict>()
      const { next, removed } = pruneBaseline(old, found, (rule, file) => {
        const key = `${rule} ${file}`
        if (!verdict.has(key)) verdict.set(key, states[Math.floor(random() * 3)]!)
        return verdict.get(key)!
      })
      const before = new Set(entries(old))
      for (const entry of entries(next)) expect(before.has(entry)).toBe(true)
      expect(entries(next).length + removed.length).toBe(before.size)
    }
  })

  test("the verdict: a rule that ran on the file checked it; disabled, failed or not-run rules did not", () => {
    const rule = (id: string, enabled = true) => ({ id, enabled, matches: (file: string) => file.endsWith(".py") })
    const verdict = entryVerdict({
      rules: [rule("ran"), rule("off", false), rule("failed")],
      compiledCleanly: true,
      ran: new Map([["ran", ["a.py"]]]),
      exists: (file) => file !== "deleted.py",
    })
    expect(verdict("ran", "a.py")).toBe("checked")
    expect(verdict("ran", "b.py")).toBe("unchecked")
    expect(verdict("ran", "deleted.py")).toBe("gone")
    expect(verdict("ran", "a.ts")).toBe("gone")
    expect(verdict("off", "a.py")).toBe("unchecked")
    expect(verdict("failed", "a.py")).toBe("unchecked")
    expect(verdict("removed", "a.py")).toBe("gone")
    // A rule missing because its repo was not fetched, or it failed to compile, has not been removed.
    const broken = entryVerdict({ rules: [], compiledCleanly: false, ran: new Map(), exists: () => true })
    expect(broken("removed", "a.py")).toBe("unchecked")
  })
})
