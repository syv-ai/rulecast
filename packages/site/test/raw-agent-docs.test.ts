import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { INSTALL_SCRIPT, REPO_ROOT } from "../scripts/sources"
import { unservedLinks, writeRawAgentDocs } from "../scripts/sync"

describe("the raw agent docs the site serves", () => {
  let publicDir = ""
  beforeAll(async () => {
    publicDir = await mkdtemp(path.join(tmpdir(), "rulecast-site-public-"))
    await cp(path.join(REPO_ROOT, INSTALL_SCRIPT), path.join(publicDir, INSTALL_SCRIPT))
    await writeRawAgentDocs(publicDir)
  })
  afterAll(() => rm(publicDir, { recursive: true, force: true }))

  it("have no relative link to a file the site does not serve", async () => {
    expect(await unservedLinks(publicDir)).toEqual([])
  })

  it("send a guide link to GitHub, and keep links between agent docs relative", async () => {
    const stats = await readFile(path.join(publicDir, "agents/reference/stats.md"), "utf8")
    expect(stats).toContain("](https://github.com/syv-ai/rulecast/blob/main/guides/agents.md#reading-the-trend)")
    const loops = await readFile(path.join(publicDir, "agents/reference/loops.md"), "utf8")
    expect(loops).toContain("](../DRAFT-RULES.md)")
    expect(loops).not.toContain("](../../")
  })

  it("names a link that would not resolve", async () => {
    await writeFile(path.join(publicDir, "agents/broken.md"), "[g](../guides/agents.md) [s](SETUP.md)")
    expect(await unservedLinks(publicDir)).toEqual(["agents/broken.md: ../guides/agents.md"])
  })
})
