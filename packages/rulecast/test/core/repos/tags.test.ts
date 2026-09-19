import { describe, expect, test } from "vitest"

import { RepoFetchError } from "../../../src/core/repos/fetch"
import { latestTag, remoteTags, type Tag } from "../../../src/core/repos/tags"
import { git } from "../../helpers/git"
import { createRuleRepo } from "../../helpers/rule-repo"

describe("remoteTags", () => {
  test("lists every tag with the commit it points to", async () => {
    const url = await createRuleRepo([
      { tag: "v0.1.0", files: { "a.txt": "one\n" } },
      { tag: "v0.2.0", files: { "a.txt": "two\n" }, annotated: true },
      { tag: "docs-snapshot", files: { "a.txt": "three\n" } },
    ])
    const commit = (tag: string) => git(url, "rev-parse", `${tag}^{commit}`)
    expect(await remoteTags(url)).toEqual([
      { name: "docs-snapshot", sha: await commit("docs-snapshot") },
      { name: "v0.1.0", sha: await commit("v0.1.0") },
      { name: "v0.2.0", sha: await commit("v0.2.0") },
    ])
  })

  test("a repo without tags has none", async () => {
    const url = await createRuleRepo([])
    expect(await remoteTags(url)).toEqual([])
  })

  test("an unreachable repo fails with git's message", async () => {
    const failure = remoteTags("/nonexistent/rulecast-rules.git")
    await expect(failure).rejects.toBeInstanceOf(RepoFetchError)
    await expect(failure).rejects.toThrow("does not appear to be a git repository")
  })
})

describe("latestTag", () => {
  const tag = (name: string): Tag => ({ name, sha: `sha-${name}` })

  test("picks the highest version, compared numerically", () => {
    expect(latestTag([tag("v0.9.0"), tag("v0.10.0"), tag("v0.2.0")])).toEqual(tag("v0.10.0"))
  })

  test("accepts versions without a v and ignores other tags", () => {
    expect(latestTag([tag("1.2.0"), tag("v1.1.9"), tag("nightly"), tag("v2.0.0-rc.1")])).toEqual(tag("1.2.0"))
  })

  test("is null when no tag is a version", () => {
    expect(latestTag([])).toBeNull()
    expect(latestTag([tag("nightly")])).toBeNull()
  })
})
