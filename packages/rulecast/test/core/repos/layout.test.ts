import path from "node:path"
import { describe, expect, test } from "vitest"

import { repoDir, repoLabel, repoName } from "../../../src/core/repos/layout"

describe("repo names", () => {
  test.each([
    ["https://github.com/syv-ai/rulecast", "syv-ai/rulecast"],
    ["https://github.com/syv-ai/rulecast.git", "syv-ai/rulecast"],
    ["https://github.com/syv-ai/rulecast/", "syv-ai/rulecast"],
    ["git@github.com:syv-ai/rulecast.git", "syv-ai/rulecast"],
    ["ssh://git@github.com/syv-ai/rulecast.git", "syv-ai/rulecast"],
    ["https://gitlab.com/group/sub/rules", "group/sub/rules"],
    ["/tmp/x/rules.git", "rules"],
    ["/tmp/x/rules/", "rules"],
    ["file:///tmp/x/rules.git", "rules"],
  ])("%s is %s", (url, name) => {
    expect(repoName(url)).toBe(name)
  })

  test("labels combine the name and the rev", () => {
    expect(repoLabel("https://github.com/syv-ai/rulecast", "v0.2.0")).toBe("syv-ai/rulecast@v0.2.0")
  })
})

describe("repo directories", () => {
  test("hosted repos are keyed by host, owner and repo", () => {
    expect(repoDir("/home", "https://github.com/syv-ai/rulecast", "v0.2.0")).toBe(
      path.join("/home", "repos", "github.com_syv-ai_rulecast", "v0.2.0"),
    )
    expect(repoDir("/home", "git@github.com:syv-ai/rulecast.git", "v0.2.0")).toBe(
      path.join("/home", "repos", "github.com_syv-ai_rulecast", "v0.2.0"),
    )
  })

  test("local repos are keyed by name and a hash of the URL", () => {
    const dir = repoDir("/home", "/tmp/x/rules.git", "v1")
    expect(dir).toMatch(/^\/home\/repos\/local_rules_[0-9a-f]{8}\/v1$/)
    expect(repoDir("/home", "/tmp/y/rules.git", "v1")).not.toBe(dir)
  })

  test("unsafe characters in revs and names become underscores", () => {
    expect(path.basename(repoDir("/home", "https://github.com/a/b", "release/1.0"))).toBe("release_1.0")
    expect(path.basename(repoDir("/home", "https://github.com/a/b", ".."))).toBe("_..")
    expect(path.basename(path.dirname(repoDir("/home", "https://example.com/a b/c", "v1")))).toBe("example.com_a_b_c")
  })
})
