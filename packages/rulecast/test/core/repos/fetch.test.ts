import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { cachedRepo, ensureRepo, fetchCheckout, RepoFetchError } from "../../../src/core/repos/fetch"
import { repoDir } from "../../../src/core/repos/layout"
import { git } from "../../helpers/git"
import { createRuleRepo } from "../../helpers/rule-repo"

const newHome = () => mkdtemp(path.join(tmpdir(), "rulecast-home-"))

const versions = () =>
  createRuleRepo([
    { tag: "v0.1.0", files: { ".rulecast-rules.yaml": "- version: one\n", "docs/a.md": "# One\n" } },
    { tag: "v0.2.0", files: { ".rulecast-rules.yaml": "- version: two\n" }, annotated: true },
  ])

const manifest = (dir: string) => readFile(path.join(dir, ".rulecast-rules.yaml"), "utf8")

describe("fetchCheckout", () => {
  test("checks out a tag without its .git directory", async () => {
    const url = await versions()
    const into = path.join(await newHome(), "checkout")
    await fetchCheckout(url, "v0.1.0", into)
    expect(await manifest(into)).toBe("- version: one\n")
    expect(await readFile(path.join(into, "docs/a.md"), "utf8")).toBe("# One\n")
    expect(existsSync(path.join(into, ".git"))).toBe(false)
  })

  test("checks out annotated tags, full commit SHAs and HEAD", async () => {
    const url = await versions()
    const home = await newHome()
    await fetchCheckout(url, "v0.2.0", path.join(home, "annotated"))
    expect(await manifest(path.join(home, "annotated"))).toBe("- version: two\n")

    const sha = await git(url, "rev-parse", "v0.1.0^{commit}")
    await fetchCheckout(url, sha, path.join(home, "sha"))
    expect(await manifest(path.join(home, "sha"))).toBe("- version: one\n")

    await fetchCheckout(url, "HEAD", path.join(home, "head"))
    expect(await manifest(path.join(home, "head"))).toBe("- version: two\n")
  })

  test("an unknown rev fails with git's message", async () => {
    const url = await versions()
    const into = path.join(await newHome(), "checkout")
    const failure = fetchCheckout(url, "v9.9.9", into)
    await expect(failure).rejects.toBeInstanceOf(RepoFetchError)
    await expect(failure).rejects.toThrow("couldn't find remote ref v9.9.9")
  })
})

describe("ensureRepo", () => {
  test("fetches a rev into the cache once", async () => {
    const url = await versions()
    const home = await newHome()
    expect(cachedRepo(home, url, "v0.1.0")).toBeNull()

    const dir = await ensureRepo(home, url, "v0.1.0")
    expect(dir).toBe(repoDir(home, url, "v0.1.0"))
    expect(cachedRepo(home, url, "v0.1.0")).toBe(dir)
    expect(await manifest(dir)).toBe("- version: one\n")

    // A cached rev is never fetched again: it still resolves after the remote is gone.
    await rm(url, { recursive: true, force: true })
    expect(await ensureRepo(home, url, "v0.1.0")).toBe(dir)
  })

  test("each rev gets its own directory", async () => {
    const url = await versions()
    const home = await newHome()
    const one = await ensureRepo(home, url, "v0.1.0")
    const two = await ensureRepo(home, url, "v0.2.0")
    expect(one).not.toBe(two)
    expect(await manifest(one)).toBe("- version: one\n")
    expect(await manifest(two)).toBe("- version: two\n")
  })

  test("concurrent fetches of one rev share a single checkout and leave no temp files", async () => {
    const url = await versions()
    const home = await newHome()
    const dirs = await Promise.all([1, 2, 3].map(() => ensureRepo(home, url, "v0.2.0")))
    expect(new Set(dirs)).toEqual(new Set([repoDir(home, url, "v0.2.0")]))
    expect(await readdir(path.dirname(dirs[0]!))).toEqual(["v0.2.0"])
    expect(await manifest(dirs[0]!)).toBe("- version: two\n")
  })

  test("a failed fetch leaves nothing in the cache", async () => {
    const url = await versions()
    const home = await newHome()
    await expect(ensureRepo(home, url, "v9.9.9")).rejects.toBeInstanceOf(RepoFetchError)
    expect(cachedRepo(home, url, "v9.9.9")).toBeNull()
    expect(await readdir(path.dirname(repoDir(home, url, "v9.9.9")))).toEqual([])
  })

  test("a temp directory left by a killed fetch is never read", async () => {
    const url = await versions()
    const home = await newHome()
    const parent = path.dirname(repoDir(home, url, "v0.1.0"))
    await mkdir(path.join(parent, ".tmp-crashed"), { recursive: true })
    await writeFile(path.join(parent, ".tmp-crashed", ".rulecast-rules.yaml"), "- partial\n")
    expect(await manifest(await ensureRepo(home, url, "v0.1.0"))).toBe("- version: one\n")
  })
})
