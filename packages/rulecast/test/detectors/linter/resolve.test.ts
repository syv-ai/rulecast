import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { describeTool, resolveTool } from "../../../src/detectors/linter/resolve"
import { createProject } from "../../helpers/project"

describe("resolveTool", () => {
  test("prefers the project's node_modules/.bin", async () => {
    const root = await createProject({})
    await mkdir(path.join(root, "node_modules", ".bin"), { recursive: true })
    const binary = path.join(root, "node_modules", ".bin", "oxlint")
    await writeFile(binary, "#!/bin/sh\n")
    await chmod(binary, 0o755)
    expect(await resolveTool("oxlint", root, () => true)).toEqual({ command: binary, prefix: [] })
  })

  test("falls back to uv run for a python tool in a uv project", async () => {
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n" })
    expect(await resolveTool("ruff", root, (command) => command === "uv")).toEqual({
      command: "uv",
      prefix: ["run", "--", "ruff"],
    })
  })

  test("does not use uv run without a pyproject.toml, or for a JavaScript tool", async () => {
    const bare = await createProject({})
    expect(await resolveTool("ruff", bare, () => true)).toEqual({ command: "ruff", prefix: [] })
    const python = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n" })
    expect(await resolveTool("eslint", python, () => true)).toEqual({ command: "eslint", prefix: [] })
  })

  test("falls back to PATH when uv is not installed", async () => {
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n" })
    expect(await resolveTool("ruff", root, () => false)).toEqual({ command: "ruff", prefix: [] })
  })
})

describe("describeTool", () => {
  test("a local binary is reported repo-relative, and found", async () => {
    const root = await createProject({})
    await mkdir(path.join(root, "node_modules", ".bin"), { recursive: true })
    const binary = path.join(root, "node_modules", ".bin", "oxlint")
    await writeFile(binary, "#!/bin/sh\n")
    await chmod(binary, 0o755)
    expect(await describeTool("oxlint", root, () => true)).toEqual({
      command: "node_modules/.bin/oxlint",
      how: "local",
      found: true,
    })
  })

  test("the uv branch is reported as the command a person would type", async () => {
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n" })
    expect(await describeTool("ruff", root, (command) => command === "uv")).toEqual({
      command: "uv run -- ruff",
      how: "uv",
      found: true,
    })
  })

  test("a bare name is found only when something on the PATH provides it", async () => {
    const root = await createProject({})
    expect(await describeTool("eslint", root, () => true)).toEqual({ command: "eslint", how: "path", found: true })
    expect(await describeTool("eslint", root, () => false)).toEqual({ command: "eslint", how: "path", found: false })
  })
})
