import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import type { Event } from "../../src/core/types"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

/**
 * Warnings reach the agent, so there has to be a number of them it can act on. A rule repo pinned
 * to a rev that has moved, or a `minimum_rulecast_version` bump, invalidates many rules at once;
 * stress testing measured 80 of them as 13,500 characters against a 9,000 character budget, with
 * the one rule that actually fired dropped whole.
 *
 * Above a threshold, compile diagnostics and detector errors each collapse to one warning carrying
 * a count and an example. The per-rule detail is in `rulecast validate` and the debug log either way.
 */
const SOURCE = "const x = compute(1)\n"

const brokenRules = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `broken/rule-${index}`,
    name: `Broken ${index}`,
    files: "\\.ts$",
    // An unparseable pattern is a compile diagnostic, which becomes one warning per rule.
    detect: { regex: { pattern: `([unclosed-${index}` } },
    message: "never",
  }))

const working = {
  id: "works/compute",
  name: "No bare compute",
  files: "\\.ts$",
  detect: { regex: { pattern: "compute\\((?<n>\\d+)\\)" } },
  message: "{{file}}:{{line}} calls compute({{n}}).",
}

/** A repo whose source file differs from its commit, so the match classifies as new. */
async function repoWith(rules: Record<string, unknown>[]): Promise<string> {
  const root = await createRepo({ ".rulecast-config.yaml": localConfig(rules), "src/app.ts": "// placeholder\n" })
  await writeFile(path.join(root, "src/app.ts"), SOURCE)
  return root
}

const send = (root: string, event: Omit<Event, "cwd">) => pipelineAt(root, { ...event, cwd: root })

const edit = (root: string, session: string) =>
  send(root, { kind: "edit", files: ["src/app.ts"], session: { id: session } })

describe("pipeline: compile diagnostics are summarised at the source", () => {
  test("a few broken rules are still named one by one", async () => {
    const root = await repoWith([...brokenRules(3), working])
    const { delivery } = await edit(root, "few")

    expect(delivery.warnings).toHaveLength(3)
    for (const text of delivery.warnings) expect(text).toContain("run rulecast validate")
  })

  test("many broken rules collapse to one warning with a count and an example", async () => {
    const root = await repoWith([...brokenRules(80), working])
    const { delivery } = await edit(root, "many")

    expect(delivery.warnings).toHaveLength(1)
    expect(delivery.warnings[0]).toMatch(/^80 rules failed to compile and were skipped — run rulecast validate\.\n/)
    expect(delivery.warnings[0]).toContain("\nFirst: .rulecast-config.yaml (broken/rule-0): ")
    // The whole point is that it is short enough to sit beside the findings.
    expect(delivery.warnings[0]!.length).toBeLessThan(400)
  })

  test("the summary is keyed on the set of rules, so a set that grows is announced again", async () => {
    const root = await repoWith([...brokenRules(80), working])
    expect((await edit(root, "growing")).delivery.warnings).toHaveLength(1)

    // The same set again says nothing: a warning is delivered once per agent context.
    expect((await edit(root, "growing")).delivery.warnings).toEqual([])

    // A rule that breaks later in the session is a different set, so the summary is announced again.
    // A single fixed key would have silenced it for the rest of the session.
    await writeFile(path.join(root, ".rulecast-config.yaml"), localConfig([...brokenRules(81), working]))
    const third = await edit(root, "growing")
    expect(third.delivery.warnings).toHaveLength(1)
    expect(third.delivery.warnings[0]).toContain("81 rules failed to compile")
  })
})

describe("pipeline: detector errors are summarised at the source", () => {
  /** Five rules whose checker does not exist: one detector error each, all of kind `command`. */
  const missingCommand = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `cmd/rule-${index}`,
      name: `Command ${index}`,
      files: "\\.ts$",
      detect: { command: { run: ["rulecast-no-such-checker", "{{files}}"] } },
      message: "{{file}}:{{line}} failed {{rule}}",
    }))

  test("a failing detector that disables many rules is one warning, not one per rule", async () => {
    const root = await repoWith(missingCommand(5))
    const { delivery, failed } = await send(root, { kind: "verify", files: ["src/app.ts"], session: { id: "cmd" } })

    expect(delivery.warnings).toHaveLength(1)
    expect(delivery.warnings[0]).toMatch(/^5 command rules were disabled this session — see debug\.log\.\n/)
    expect(delivery.warnings[0]).toContain("\nFirst: command detector failed for cmd/rule-0")
    // A detector that fails is still a rulecast failure, summarised or not (§14).
    expect(failed).toBe(true)
  })

  test("a few failing rules keep their own messages", async () => {
    const root = await repoWith(missingCommand(2))
    const { delivery } = await send(root, { kind: "verify", files: ["src/app.ts"], session: { id: "cmd-few" } })

    expect(delivery.warnings).toHaveLength(2)
    for (const text of delivery.warnings) expect(text).toContain("Disabled for this session.")
  })
})
