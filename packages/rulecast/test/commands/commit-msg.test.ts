import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { messageOf } from "../../src/commands/commit-msg"
import { runCli } from "../helpers/cli"
import { localConfig } from "../helpers/config"
import { createRepo, git } from "../helpers/git"

const NO_AI_TRAILERS = {
  id: "commits/no-ai-trailers",
  name: "No AI co-sign trailers",
  stages: ["commit-msg"],
  detect: { regex: { pattern: "^co-authored-by:.*\\b(claude|copilot)\\b.*$", flags: "im" } },
  message: "{{file}}:{{line}}: AI co-sign trailer",
}

const LINE_LENGTH = {
  id: "commits/line-length",
  name: "Message lines wrap at 72",
  stages: ["commit-msg"],
  detect: { regex: { pattern: "^.{73,}$", flags: "m" } },
  message: "{{file}}:{{line}}: wrap at 72",
}

const SCISSORS = "------------------------ >8 ------------------------"

describe("messageOf (#79)", () => {
  test("blanks git's comment lines, so line numbers hold, and drops everything from the scissors line", () => {
    expect(messageOf("feat: x\n\nbody\n# Please enter the commit message\n# Co-Authored-By: Claude\n")).toBe(
      "feat: x\n\nbody\n\n\n",
    )
    expect(messageOf(`feat: x\n# ${SCISSORS}\ndiff --git a/x b/x\n`)).toBe("feat: x\n")
  })

  test("the comment string is the one the scissors line names, else the configured one", () => {
    const verbose = `feat: x\n; Please enter\n; ${SCISSORS}\n+${"y".repeat(100)}\n`
    expect(messageOf(verbose)).toBe("feat: x\n\n")
    expect(messageOf(`feat: x\n// Please enter\n// ${SCISSORS}\r\n+diff\n`)).toBe("feat: x\n\n")
    expect(messageOf("feat: x\n; note\n# kept\n", { comment: ";" })).toBe("feat: x\n\n# kept\n")
  })

  test("with comments kept (commit.cleanup whitespace, verbatim or scissors) only the scissors cut applies", () => {
    expect(messageOf(`fix\n# Generated with Claude Code\n# ${SCISSORS}\ndiff\n`, { keepComments: true })).toBe(
      "fix\n# Generated with Claude Code\n",
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
      { ...NO_AI_TRAILERS, id: "d", detect: { llm: { model: "haiku", question: "Is there an AI trailer?" } } },
      { ...NO_AI_TRAILERS, id: "e", types: ["python"] },
      { ...NO_AI_TRAILERS, id: "f", types_or: ["python"] },
      { ...NO_AI_TRAILERS, id: "g", exclude_types: ["python"] },
      { ...NO_AI_TRAILERS, id: "h", detect: { regex: { pattern: "^Co-Authored-By: .*$", flags: "m", fix: "" } } },
    ])
    const { stdout } = await runCli(root, ["validate"])
    expect(stdout).toContain("(d): stages [commit-msg] cannot use llm, which costs money on every commit")
    for (const id of ["e", "f", "g"]) {
      expect(stdout).toContain(
        `(${id}): a commit-msg rule judges the message: leave out files, exclude and the type tags`,
      )
    }
    expect(stdout).toContain("(h): fix does not apply to a commit message")
    expect(stdout).toContain(
      "(a): stages [commit-msg] judge the commit message: it cannot share a rule with other stages",
    )
    expect(stdout).toContain("(b): stages [commit-msg] need a detector that judges the text it is given")
    expect(stdout).toContain("(c): a commit-msg rule judges the message: leave out files, exclude and the type tags")
  })

  test("--commit-msg takes no files, refs or rule id, and no --llm, --no-llm or --session", async () => {
    const root = await project([NO_AI_TRAILERS])
    expect((await runCli(root, ["run", "--commit-msg", "msg.txt", "--all-files"])).code).toBe(2)
    for (const flag of [["--llm"], ["--no-llm"], ["--session", "abc"]]) {
      const result = await runCli(root, ["run", "--commit-msg", "msg.txt", ...flag])
      expect(result.code, flag[0]).toBe(2)
      expect(result.stderr, flag[0]).toContain(flag[0])
    }
  })

  test("a reported line is the line in the message file, with comment lines above it", async () => {
    const root = await project([NO_AI_TRAILERS])
    const result = await message(root, "fix\n\n# a comment\n\nCo-Authored-By: Claude\n")
    expect(result.stdout).toContain("COMMIT_EDITMSG:5:1")
  })

  test("core.commentChar: its comment lines and verbose diff are not the message", async () => {
    const root = await project([LINE_LENGTH])
    await git(root, "config", "core.commentChar", ";")
    const long = "y".repeat(100)
    // An editor commit with -v: the template's comment lines, then the scissors line and the diff.
    expect((await message(root, `fix\n; ${long}\n; ${SCISSORS}\n+${long}\n`)).code).toBe(0)
    // No scissors line: the configured comment string still says which lines are comments.
    expect((await message(root, `fix\n; ${long}\n`)).code).toBe(0)
    await git(root, "config", "core.commentString", "//")
    expect((await message(root, `fix\n// ${long}\n`)).code).toBe(0)
    expect((await message(root, `fix\n; ${long}\n`)).code).toBe(1)
  })

  test("commit.cleanup that keeps comment lines: a # line is judged, as git records it", async () => {
    const root = await project([LINE_LENGTH])
    await git(root, "config", "commit.cleanup", "whitespace")
    const result = await message(root, `fix\n\n# ${"y".repeat(100)}\n`)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("COMMIT_EDITMSG:3:1")
  })

  test("every config in the repository judges the message, with or without one at its top", async () => {
    const pkgOnly = await createRepo({ "pkg/.rulecast-config.yaml": localConfig([NO_AI_TRAILERS]) })
    const bad = await message(pkgOnly, "fix\n\nCo-Authored-By: Claude\n")
    expect(bad.code, bad.stderr).toBe(1)
    expect(bad.stdout).toContain("commits/no-ai-trailers")
    expect((await message(pkgOnly, "fix\n")).code).toBe(0)

    const both = await createRepo({
      ".rulecast-config.yaml": localConfig([LINE_LENGTH]),
      "pkg/.rulecast-config.yaml": localConfig([NO_AI_TRAILERS]),
    })
    const found = await message(both, `fix\n\nCo-Authored-By: Claude\n${"y".repeat(100)}\n`)
    expect(found.code).toBe(1)
    expect(found.stdout).toContain("commits/no-ai-trailers")
    expect(found.stdout).toContain("commits/line-length")
  })

  test("only a broken commit-msg rule makes it incomplete: a broken rule for files elsewhere does not block commits", async () => {
    const brokenFileRule = {
      id: "no-todo",
      name: "No TODO",
      stages: ["verify"],
      detect: { regex: { pattern: "(?i)todo" } },
      message: "{{file}}: TODO",
    }
    const root = await createRepo({
      ".rulecast-config.yaml": localConfig([NO_AI_TRAILERS]),
      "pkg/b/.rulecast-config.yaml": localConfig([brokenFileRule, { ...brokenFileRule, id: "no-todo-default" }]),
    })
    const clean = await message(root, "fix\n")
    expect(clean.code, clean.stderr).toBe(0)
    const bad = await message(root, "fix\n\nCo-Authored-By: Claude\n")
    expect(bad.code).toBe(1)
    expect(bad.stdout).toContain("commits/no-ai-trailers")

    const brokenMessageRule = { ...NO_AI_TRAILERS, id: "commits/broken", detect: { regex: { pattern: "(?i)x" } } }
    await writeFile(path.join(root, "pkg/b/.rulecast-config.yaml"), localConfig([brokenFileRule, brokenMessageRule]))
    const incomplete = await message(root, "fix\n")
    expect(incomplete.code).toBe(3)
    expect(incomplete.stderr).toContain("commits/broken")
    expect(incomplete.stderr).not.toContain("no-todo")
  })

  test("a broken rule under default_stages: [commit-msg] counts as a commit-msg rule", async () => {
    const root = await createRepo({
      "pkg/.rulecast-config.yaml": localConfig(
        [{ id: "x", name: "X", detect: { regex: { pattern: "(?i)x" } }, message: "{{file}}: x" }],
        { default_stages: ["commit-msg"] },
      ),
    })
    expect((await message(root, "fix\n")).code).toBe(3)
  })

  test("a config that does not load stops the run, named by its path", async () => {
    const root = await createRepo({ ".rulecast-config.yaml": localConfig([NO_AI_TRAILERS]) })
    await mkdir(path.join(root, "pkg", "x"), { recursive: true })
    await writeFile(path.join(root, "pkg", "x", ".rulecast-config.yaml"), "repos: [\n")
    const result = await message(root, "fix\n")
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("pkg/x/.rulecast-config.yaml")
  })

  test("with no config anywhere it says so, as run does", async () => {
    const root = await createRepo({ "a.txt": "a\n" })
    await mkdir(path.join(root, "pkg"))
    const result = await message(root, "fix\n")
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(".rulecast-config.yaml")
  })
})
