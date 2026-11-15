import { chmod, readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"
import { pipelineAt } from "../helpers/pipeline"

// A formatter hook rule at an agent's stop leaves its change in the file: another agent may be
// editing it, and putting it back would revert that edit (AKA lead, 0.16.0; the developer's call,
// 2026-11-15). Anywhere else rulecast still puts the file back.

/** A lefthook whose `dump` has one job, `fmt`, that rewrites every file it is given. */
async function formatterRepo(): Promise<string> {
  const dump = JSON.stringify({ "pre-commit": { jobs: [{ name: "fmt", run: "./fmt.sh {staged_files}" }] } })
  const root = await createRepo({
    ".rulecast-config.yaml": localConfig([
      {
        id: "fmt",
        name: "fmt",
        files: "\\.py$",
        detect: { hook: { lefthook: "pre-commit/fmt" } },
        message: "{{message}}",
      },
    ]),
    "lefthook.yml": "pre-commit:\n  jobs: []\n",
    "node_modules/.bin/lefthook": `#!/bin/sh\ncat <<'OUT'\n${dump}\nOUT\n`,
    "fmt.sh": `#!/bin/sh\nfor f in "$@"; do printf 'a = 1\\n' > "$f"; done\n`,
    "a.py": "a=1\n",
  })
  await chmod(path.join(root, "node_modules/.bin/lefthook"), 0o755)
  await chmod(path.join(root, "fmt.sh"), 0o755)
  return root
}

describe("a formatter hook's change", () => {
  test.each([
    [true, "a = 1\n", "pre-commit/fmt changed this file; check the change and keep or undo it"],
    [false, "a=1\n", "pre-commit/fmt would change this file"],
  ])("agentHook %s: the file is %j afterwards, and the change is the finding", async (agentHook, after, message) => {
    const root = await formatterRepo()
    const event = { kind: "verify" as const, files: ["a.py"], cwd: root }
    const { delivery } = await pipelineAt(root, event, { agentHook })
    expect(await readFile(path.join(root, "a.py"), "utf8")).toBe(after)
    expect(delivery.findings.map((finding) => finding.message)).toEqual([message])
  })
})
