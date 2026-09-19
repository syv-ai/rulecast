import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { repoLabel } from "../../../src/core/repos/layout"
import { cachedRepos, fetchingRepos, fixedRepo } from "../../../src/core/repos/provider"
import { TEST_HOME } from "../../helpers/home"
import { createRuleRepo } from "../../helpers/rule-repo"

describe("repo providers", () => {
  test("the cache never fetches; fetching fills the cache", async () => {
    const url = await createRuleRepo([{ tag: "v1.0.0", files: { "a.md": "# A\n" } }])
    expect(await cachedRepos(TEST_HOME).checkout(url, "v1.0.0")).toEqual({
      ok: false,
      missing: true,
      message: "not in the cache",
    })
    const fetched = await fetchingRepos(TEST_HOME).checkout(url, "v1.0.0")
    expect(fetched).toMatchObject({ ok: true, label: repoLabel(url, "v1.0.0") })
    if (!fetched.ok) return
    expect(readFileSync(path.join(fetched.dir, "a.md"), "utf8")).toBe("# A\n")
    expect(await cachedRepos(TEST_HOME).checkout(url, "v1.0.0")).toEqual(fetched)
  })

  test("a failed fetch is reported, not thrown", async () => {
    const url = await createRuleRepo([{ tag: "v1.0.0", files: { "a.md": "# A\n" } }])
    const result = await fetchingRepos(TEST_HOME).checkout(url, "v9.9.9")
    expect(result).toMatchObject({ ok: false, missing: false })
    if (!result.ok) expect(result.message).toMatch(/^fetch failed: /)
  })

  test("a fixed repo answers every url with its directory", async () => {
    const provider = fixedRepo("/work/rules", "rules@working-tree")
    expect(await provider.checkout("anything", "any")).toEqual({
      ok: true,
      dir: "/work/rules",
      label: "rules@working-tree",
    })
  })
})
