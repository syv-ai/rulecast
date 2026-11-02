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
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n", "uv.lock": "" })
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
    const top = await createProject({ "pkg/pyproject.toml": "", "pkg/uv.lock": "" })
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

describe("resolveTool and a project virtualenv", () => {
  async function executable(file: string) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "#!/bin/sh\n")
    await chmod(file, 0o755)
  }

  test("finds ruff in a package's .venv/bin from the package", async () => {
    const top = await createProject({ "pkg/pyproject.toml": "" })
    const pkg = path.join(top, "pkg")
    const binary = path.join(pkg, ".venv", "bin", "ruff")
    await executable(binary)
    expect(await resolveTool("ruff", pkg, () => false, top)).toEqual({ command: binary, prefix: [] })
    expect(await describeTool("ruff", top, { available: () => false, top, dir: pkg })).toEqual({
      command: "pkg/.venv/bin/ruff",
      how: "local",
      found: true,
    })
  })

  test("finds venv/bin above the directory, up to the top", async () => {
    const top = await createProject({ "pkg/pyproject.toml": "" })
    const binary = path.join(top, "venv", "bin", "ruff")
    await executable(binary)
    expect(await resolveTool("ruff", path.join(top, "pkg"), () => false, top)).toEqual({ command: binary, prefix: [] })
  })

  test("a project's .venv beats uv run", async () => {
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n", "uv.lock": "" })
    const binary = path.join(root, ".venv", "bin", "ruff")
    await executable(binary)
    expect(await resolveTool("ruff", root, () => true)).toEqual({ command: binary, prefix: [] })
  })

  test("node_modules/.bin still comes first", async () => {
    const root = await createProject({})
    await executable(path.join(root, ".venv", "bin", "ruff"))
    const local = path.join(root, "node_modules", ".bin", "ruff")
    await executable(local)
    expect(await resolveTool("ruff", root, () => false)).toEqual({ command: local, prefix: [] })
  })

  test("a JavaScript tool ignores the .venv", async () => {
    const root = await createProject({})
    await executable(path.join(root, ".venv", "bin", "eslint"))
    expect(await resolveTool("eslint", root, () => true)).toEqual({ command: "eslint", prefix: [] })
  })
})

describe("resolveTool and uv.lock", () => {
  // uv run in a project without a lock would write uv.lock and a .venv into the user's tree.
  test("a pyproject.toml without a uv.lock is not run through uv", async () => {
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n" })
    expect(await resolveTool("ruff", root, () => true)).toEqual({ command: "ruff", prefix: [] })
  })

  test("a workspace member uses uv when the lock is at the workspace root", async () => {
    const top = await createProject({ "uv.lock": "", "pkg/pyproject.toml": "" })
    expect(await resolveTool("ruff", path.join(top, "pkg"), () => true, top)).toEqual({
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
    const root = await createProject({ "pyproject.toml": "[project]\nname = 'x'\n", "uv.lock": "" })
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
