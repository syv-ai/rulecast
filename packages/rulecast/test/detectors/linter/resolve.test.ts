import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { describeTool, resolveTool, runDirFor } from "../../../src/detectors/linter/resolve"
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

describe("runDirFor", () => {
  test("the nearest directory with one of the tool's own config files, else the root", async () => {
    const root = await createProject({
      "pyproject.toml": "",
      "api/ruff.toml": "",
      "api/app/deep/a.py": "",
      "web/eslint.config.mjs": "",
      "web/src/a.js": "",
    })
    expect(await runDirFor("ruff", "api/app/deep/a.py", root, root)).toBe(path.join(root, "api"))
    expect(await runDirFor("ruff", "web/src/a.py", root, root)).toBe(root)
    expect(await runDirFor("eslint", "web/src/a.js", root, root)).toBe(path.join(root, "web"))
    // Another tool's config is not this one's.
    expect(await runDirFor("oxlint", "web/src/a.js", root, root)).toBe(root)
  })

  test("looks above the root up to the repository's top, and no further", async () => {
    const top = await createProject({ ".oxlintrc.json": "{}", "pkg/src/a.js": "" })
    const root = path.join(top, "pkg")
    expect(await runDirFor("oxlint", "src/a.js", root, top)).toBe(top)
    // With the top at the root, a config above it is outside the repository.
    expect(await runDirFor("oxlint", "src/a.js", root, root)).toBe(root)
  })
})

describe("resolveTool from a directory", () => {
  test("looks in node_modules/.bin from the directory up to the top", async () => {
    const top = await createProject({ "pkg/pyproject.toml": "" })
    await mkdir(path.join(top, "node_modules", ".bin"), { recursive: true })
    const binary = path.join(top, "node_modules", ".bin", "ruff")
    await writeFile(binary, "#!/bin/sh\n")
    await chmod(binary, 0o755)
    expect(await resolveTool("ruff", path.join(top, "pkg"), () => true, top)).toEqual({ command: binary, prefix: [] })
    // Without the top, only the directory's own: and it is a uv project.
    expect(await resolveTool("ruff", path.join(top, "pkg"), () => true)).toEqual({
      command: "uv",
      prefix: ["run", "--", "ruff"],
    })
  })
})

describe("describeTool", () => {
  test("a local binary is reported repo-relative, and found", async () => {
    const root = await createProject({})
    await mkdir(path.join(root, "node_modules", ".bin"), { recursive: true })
    const binary = path.join(root, "node_modules", ".bin", "oxlint")
    await writeFile(binary, "#!/bin/sh\n")
    await chmod(binary, 0o755)
    expect(await describeTool("oxlint", root, { available: () => true })).toEqual({
      command: "node_modules/.bin/oxlint",
      how: "local",
      found: true,
    })
  })

  test("the uv branch is reported as the command a person would type", async () => {
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n" })
    expect(await describeTool("ruff", root, { available: (command) => command === "uv" })).toEqual({
      command: "uv run -- ruff",
      how: "uv",
      found: true,
    })
  })

  test("a bare name is found only when something on the PATH provides it", async () => {
    const root = await createProject({})
    expect(await describeTool("eslint", root, { available: () => true })).toEqual({
      command: "eslint",
      how: "path",
      found: true,
    })
    expect(await describeTool("eslint", root, { available: () => false })).toEqual({
      command: "eslint",
      how: "path",
      found: false,
    })
  })
})
