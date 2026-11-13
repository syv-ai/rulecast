import { writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { messageOf } from "../../src/commands/commit-msg"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo } from "../helpers/git"

const NO_AI_TRAILERS = {
  id: "commits/no-ai-trailers",
  name: "No AI co-sign trailers",
  stages: ["commit-msg"],
  detect: { regex: { pattern: "^co-authored-by:.*\\b(claude|copilot)\\b.*$", flags: "im" } },
  message: "{{file}}:{{line}}: AI co-sign trailer",
}

describe("messageOf (#79)", () => {
  test("drops git's comment lines and everything from the scissors line", () => {
    expect(messageOf("feat: x\n\nbody\n# Please enter the commit message\n# Co-Authored-By: Claude\n")).toBe(
      "feat: x\n\nbody\n",
    )
    expect(messageOf("feat: x\n# ------------------------ >8 ------------------------\ndiff --git a/x b/x\n")).toBe(
      "feat: x\n",
    )
  })
})

describe("rulecast run --commit-msg (#79)", () => {
  const project = (rules: Record<string, unknown>[]) => createRepo({ ".rulecast-config.yaml": localConfig(rules) })
  const message = async (root: string, text: string) => {
    await writeFile(path.join(root, "msg.txt"), text)
    return runCli(root, ["run", "--commit-msg", "msg.txt"])
  }

  test("a commit-msg rule reports a line of the message, and only of the message", async () => {
    const root = await project([NO_AI_TRAILERS])
    const bad = await message(
      root,
      "feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n# Co-Authored-By: Copilot\n",
    )
    expect(bad.code).toBe(1)
    expect(bad.stdout).toContain("COMMIT_EDITMSG:3:1  error    commits/no-ai-trailers")
    expect(bad.stdout).not.toContain(":4:")
    expect((await message(root, "feat: x\n\nCo-Authored-By: A Person <a@b.c>\n")).code).toBe(0)
  })

  test("other rules never judge the message, and a commit-msg rule never runs on files", async () => {
    const root = await project([
      NO_AI_TRAILERS,
      { id: "no-todo", name: "No TODO", detect: { regex: { pattern: "TODO" } }, message: "{{file}}: TODO" },
    ])
    expect((await message(root, "feat: TODO later\n")).code).toBe(0)
    await writeFile(path.join(root, "a.py"), "# Co-Authored-By: Claude\n")
    const files = await runCli(root, ["run", "--files", "a.py"])
    expect(files.stdout).not.toContain("commits/no-ai-trailers")
  })

  test("a commit-msg rule that did not compile fails the run as incomplete, never as clean", async () => {
    const root = await project([{ ...NO_AI_TRAILERS, detect: { regex: { pattern: "(?i)claude" } } }])
    const result = await message(root, "feat: x\n")
    expect(result.code).toBe(3)
    expect(result.stderr).toContain("commits/no-ai-trailers")
  })

  test("validate: commit-msg is a rule's only stage, with a detector that judges given text and no files", async () => {
    const root = await project([
      { ...NO_AI_TRAILERS, id: "a", stages: ["commit-msg", "verify"] },
      { ...NO_AI_TRAILERS, id: "b", detect: { path: {} } },
      { ...NO_AI_TRAILERS, id: "c", files: "\\.py$" },
    ])
    const { stdout } = await runCli(root, ["validate"])
    expect(stdout).toContain(
      "(a): stages [commit-msg] judge the commit message: it cannot share a rule with other stages",
    )
    expect(stdout).toContain("(b): stages [commit-msg] need a detector that judges the text it is given")
    expect(stdout).toContain("(c): a commit-msg rule judges the message: leave out files and exclude")
  })

  test("--commit-msg takes no files, refs or rule id", async () => {
    const root = await project([NO_AI_TRAILERS])
    expect((await runCli(root, ["run", "--commit-msg", "msg.txt", "--all-files"])).code).toBe(2)
  })
})
