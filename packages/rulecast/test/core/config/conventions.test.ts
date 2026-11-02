import path from "node:path"
import { describe, expect, test } from "vitest"

import { conventionsFor } from "../../../src/core/config/conventions"
import { createRepo } from "../../helpers/git"

const config = (conventions?: string) =>
  `${conventions === undefined ? "" : `conventions: ${conventions}\n`}repos:\n  - repo: local\n    rules: []\n`

describe("conventionsFor", () => {
  test("each config may name its own; otherwise the nearest config above that names one applies", async () => {
    const top = await createRepo({
      ".rulecast-config.yaml": config("docs/conventions/"),
      "packages/a/.rulecast-config.yaml": config(),
      "packages/a/sub/.rulecast-config.yaml": config("NOTES.md"),
    })
    expect(await conventionsFor(top)).toEqual({ path: "docs/conventions/", from: ".rulecast-config.yaml" })
    expect(await conventionsFor(path.join(top, "packages/a"))).toEqual({
      path: "docs/conventions/",
      from: ".rulecast-config.yaml",
    })
    expect(await conventionsFor(path.join(top, "packages/a/sub"))).toEqual({
      path: "packages/a/sub/NOTES.md",
      from: "packages/a/sub/.rulecast-config.yaml",
    })
  })

  test("a path relative to a package config is given relative to the repository", async () => {
    const top = await createRepo({ "packages/a/.rulecast-config.yaml": config("../../docs/a.md") })
    expect(await conventionsFor(path.join(top, "packages/a"))).toEqual({
      path: "docs/a.md",
      from: "packages/a/.rulecast-config.yaml",
    })
  })

  test("null when no config above names one", async () => {
    const top = await createRepo({ ".rulecast-config.yaml": config() })
    expect(await conventionsFor(top)).toBeNull()
  })

  test("a config that does not load is skipped, not fatal", async () => {
    const top = await createRepo({
      ".rulecast-config.yaml": config("docs/c.md"),
      "a/.rulecast-config.yaml": "repos: [\n",
    })
    expect(await conventionsFor(path.join(top, "a"))).toEqual({ path: "docs/c.md", from: ".rulecast-config.yaml" })
  })
})
