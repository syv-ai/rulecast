import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { computeChanges } from "../../../src/core/baseline/baseline"
import { classify } from "../../../src/core/baseline/fingerprint"
import { snapshotOf } from "../../../src/core/baseline/hash"
import type { RuleScope } from "../../../src/core/config/schema"
import { renderAgentText } from "../../../src/core/delivery/render-agent"
import type { Delivery, Match } from "../../../src/core/types"
import { createProject } from "../../helpers/project"

/**
 * The renderer's output and §8's classification, recorded as data rather than as TypeScript.
 *
 * Adding a case is adding a file; see `test/goldens/README.md`. These exist so that a change which
 * is meant to preserve behaviour can be shown to have done so, and so that the contract outlives
 * the implementation — the spec (§17) claims the recorded contracts are the specification.
 */

const goldens = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../goldens")
const casesIn = (dir: string, suffix: string) =>
  readdirSync(path.join(goldens, dir))
    .filter((file) => file.endsWith(suffix))
    .sort()
    .map((file) => [file.slice(0, -suffix.length), path.join(goldens, dir, file)] as const)

describe("delivery goldens", () => {
  const cases = casesIn("delivery", ".delivery.json")

  test("the corpus is not empty", () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  test.each(cases)("%s", (_name, file) => {
    const { options, delivery } = JSON.parse(readFileSync(file, "utf8")) as {
      options: { maxMatchesPerRule: number }
      delivery: Delivery
    }
    const expected = readFileSync(file.replace(".delivery.json", ".expected.txt"), "utf8")
    // toBe on strings prints a line diff on failure, which is the point of a golden.
    expect(renderAgentText(delivery, options)).toBe(expected)
  })
})

interface ClassificationCase {
  about: string
  /** null: the file has no baseline at all. */
  baseline: string | null
  current: string
  scope: RuleScope
  /** The container rule's recorded baseline ranges; null when no record was ever written. */
  fingerprints: [number, number][] | null
  match: [line: number, endLine: number]
  expected: "new" | "preexisting"
}

describe("classification goldens", () => {
  const cases = casesIn("classification", ".json")
  const FILE = "app/routes.py"
  const RULE = "golden/rule"

  test("the corpus is not empty", () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  test.each(cases)("%s", async (_name, file) => {
    const golden = JSON.parse(readFileSync(file, "utf8")) as ClassificationCase
    const root = await createProject({ [FILE]: golden.current })

    // A snapshot, not a commit, so the corpus needs no git.
    const snapshots = golden.baseline === null ? new Map() : new Map([[FILE, snapshotOf(golden.baseline)]])
    const changes = await computeChanges(root, [FILE], { snapshots, fallbackCommit: null })
    const fingerprints =
      golden.fingerprints === null ? new Map() : new Map([[FILE, new Map([[RULE, golden.fingerprints]])]])

    const [line, endLine] = golden.match
    const match: Match = { file: FILE, line, endLine, column: 1, text: "", captures: {} }
    expect(classify(match, golden.scope, RULE, changes, fingerprints), golden.about).toBe(golden.expected)
  })
})
