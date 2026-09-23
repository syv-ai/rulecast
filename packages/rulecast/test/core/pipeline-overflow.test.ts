import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { renderAgentText } from "../../src/core/delivery/render-agent"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { stateDirFor } from "../helpers/home"
import { pipelineAt } from "../helpers/pipeline"

/** Ten rules, each citing its own section: more floor than a small budget can hold. */
const RULES = Array.from({ length: 10 }, (_, index) => ({
  id: `backend/rule-${index}`,
  name: `Rule ${index}`,
  files: "^app/services/.*\\.py$",
  detect: { regex: { pattern: `raise Error${index}\\((?<code>[^)]*)\\)` } },
  message: `{{file}}:{{line}} raises Error${index}({{code}}) in the service layer. Raise a domain exception instead; app/api/errors.py maps it.`,
  context: [`@conventions/backend.md#section-${index}`],
}))

const CONVENTIONS = [
  "# Backend",
  ...RULES.flatMap((_, index) => [`## Section ${index}`, `Reason number ${index}. `.repeat(12), ""]),
].join("\n")

const SERVICE = ["def get(x):", ...RULES.map((_, index) => `    raise Error${index}("E${index}")`)].join("\n")

const files = {
  ".rulecast-config.yaml": localConfig(RULES),
  "conventions/backend.md": CONVENTIONS,
  "app/services/users.py": "def get(x):\n    return x\n",
}

const deliveriesIn = (root: string) => path.join(stateDirFor(root), "deliveries")

describe("pipeline: a delivery that does not fit", () => {
  test("writes the whole delivery to a file and points the message at it", async () => {
    const root = await createRepo(files)
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path.join(root, "app/services/users.py"), SERVICE)

    const { delivery } = await pipelineAt(
      root,
      { kind: "edit", files: ["app/services/users.py"], cwd: root, session: { id: "s1" } },
      { maxContextChars: 900 },
    )

    expect(delivery.omitted.rules).toBeGreaterThan(0)
    expect(delivery.overflowPath).not.toBeNull()
    expect(delivery.overflowPath!.startsWith(deliveriesIn(root))).toBe(true)

    const message = renderAgentText(delivery, { maxMatchesPerRule: 10 })
    expect(message.length).toBeLessThanOrEqual(900)
    expect(message).toContain("rules and the conventions they cite did not fit here.")
    expect(message).toContain(delivery.overflowPath!)

    // Every rule that fired is in the file, including the ones the message had no room for.
    const written = readFileSync(delivery.overflowPath!, "utf8")
    for (const rule of RULES) expect(written).toContain(rule.id)
    expect(readdirSync(deliveriesIn(root))).toHaveLength(1)
  })

  test("a delivery that fits writes no file at all", async () => {
    const root = await createRepo(files)
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path.join(root, "app/services/users.py"), 'def get(x):\n    raise Error0("E0")\n')

    const { delivery } = await pipelineAt(
      root,
      { kind: "edit", files: ["app/services/users.py"], cwd: root, session: { id: "s1" } },
      { maxContextChars: 9000 },
    )

    expect(delivery.omitted.rules).toBe(0)
    expect(delivery.overflowPath).toBeNull()
    expect(existsSync(deliveriesIn(root))).toBe(false)
  })
})
