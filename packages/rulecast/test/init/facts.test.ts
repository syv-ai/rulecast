import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { ADAPTERS } from "../../src/adapters"
import { readSourceFile } from "../../src/core/detection/per-rule"
import { allFiles } from "../../src/core/git"
import { markerExists } from "../../src/init/detect"
import { type SetupFacts, setupFacts } from "../../src/init/facts"
import { createRepo, git } from "../helpers/git"
import { createProject } from "../helpers/project"

async function facts(root: string): Promise<SetupFacts> {
  return setupFacts({
    root,
    files: await allFiles(root),
    read: (file) => readSourceFile(root, file),
    exists: markerExists(root),
    adapters: ADAPTERS,
  })
}

async function commit(root: string, file: string, author: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true })
  await writeFile(path.join(root, file), `${author}\n`)
  await git(root, "add", "-A")
  await git(root, "commit", "-q", "--author", author, "-m", file)
}

describe("setupFacts", () => {
  test("committers counts distinct emails over six months and leaves bots out", async () => {
    const root = await createProject({ "a.txt": "" })
    await git(root, "init", "-q", "-b", "main")
    await commit(root, "a.txt", "A <a@x>")
    await commit(root, "b.txt", "B <b@x>")
    await commit(root, "c.txt", "A <A@x>")
    await commit(root, "d.txt", "dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>")
    expect((await facts(root)).committers).toEqual({ count: 2, since: "6 months" })
  })

  test("committers is null with no commits", async () => {
    const root = await createProject({ "a.py": "x = 1\n" })
    await git(root, "init", "-q", "-b", "main")
    const found = await facts(root)
    expect(found.committers).toBeNull()
    expect(found.packages).toEqual([])
  })

  test("committers is null when nobody but bots committed", async () => {
    const root = await createProject({})
    await git(root, "init", "-q", "-b", "main")
    await commit(root, "a.txt", "dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>")
    expect((await facts(root)).committers).toBeNull()
  })

  test("committers is null in a shallow clone, whose history undercounts", async () => {
    const origin = await createProject({})
    await git(origin, "init", "-q", "-b", "main")
    await commit(origin, "a.txt", "A <a@x>")
    await commit(origin, "b.txt", "B <b@x>")
    const parent = await createProject({})
    await git(parent, "clone", "-q", "--depth", "1", `file://${origin}`, "shallow")
    expect((await facts(path.join(parent, "shallow"))).committers).toBeNull()
  })

  test("an unreadable manifest reads as missing", async () => {
    const root = await createRepo({ "backend/pyproject.toml": "[project]\n", "backend/app.py": "x = 1\n" })
    const found = await setupFacts({
      root,
      files: await allFiles(root),
      read: async (file) => {
        if (file === "package.json" || file.endsWith(".toml")) throw new Error("EACCES")
        return readSourceFile(root, file)
      },
      exists: markerExists(root),
      adapters: ADAPTERS,
    })
    expect(found.packages.map((entry) => entry.dir)).toEqual(["backend/"])
  })

  test("in a package, committers counts only commits touching it", async () => {
    const root = await createProject({})
    await git(root, "init", "-q", "-b", "main")
    await commit(root, "backend/app.py", "A <a@x>")
    await commit(root, "frontend/app.ts", "B <b@x>")
    await commit(root, "frontend/other.ts", "C <c@x>")
    expect((await facts(path.join(root, "backend"))).committers).toEqual({ count: 1, since: "6 months" })
  })

  test("packages: declared workspaces and top-level manifests, with stack, agentDoc and config", async () => {
    const root = await createRepo({
      "package.json": JSON.stringify({ workspaces: ["frontend", "packages/*"] }),
      "frontend/package.json": JSON.stringify({ dependencies: { react: "19" } }),
      "frontend/src/main.tsx": "export {}\n",
      "frontend/AGENTS.md": "# Frontend\n",
      "backend/pyproject.toml": "[project]\nname = 'app'\n",
      "backend/app/main.py": "x = 1\n",
      "backend/.rulecast-config.yaml": "repos: []\n",
      "packages/emails/package.json": "{}\n",
      "packages/emails/index.js": "x\n",
      "deep/below/package.json": "{}\n",
      "vendor/x/go.mod": "module x\n",
    })
    expect((await facts(root)).packages).toEqual([
      { dir: "backend/", manifest: "pyproject.toml", stack: ["python"], agentDoc: false, config: true },
      { dir: "frontend/", manifest: "package.json", stack: ["typescript", "react"], agentDoc: true, config: false },
      { dir: "packages/emails/", manifest: "package.json", stack: ["javascript"], agentDoc: false, config: false },
    ])
  })

  test("packages: pnpm, Cargo and uv workspaces", async () => {
    const root = await createRepo({
      "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - '!apps/skip'\n",
      "apps/web/package.json": "{}\n",
      "apps/skip/package.json": "{}\n",
      "Cargo.toml": '[workspace]\nmembers = [\n  "crates/core",\n]\n\n[package]\nname = "x"\n',
      "crates/core/Cargo.toml": "[package]\n",
      "pyproject.toml": '[tool.uv.workspace]\nmembers = ["libs/*"]\n',
      "libs/one/pyproject.toml": "[project]\n",
    })
    expect((await facts(root)).packages.map((entry) => entry.dir)).toEqual(["apps/web/", "crates/core/", "libs/one/"])
  })

  test("sessions lists a package's .claude/ but not the root's", async () => {
    const root = await createRepo({
      ".claude/settings.json": "{}\n",
      "backend/pyproject.toml": "[project]\n",
      "backend/.claude/settings.json": "{}\n",
      "frontend/package.json": "{}\n",
      "docs/AGENTS.md": "# Docs\n",
      "docs/CLAUDE.md": "@AGENTS.md\n",
    })
    expect((await facts(root)).sessions).toEqual(["backend/", "docs/"])
  })

  test("gitHooks names each manager and whether rulecast is already in it", async () => {
    const root = await createRepo({
      ".pre-commit-config.yaml":
        "repos:\n  - repo: https://github.com/syv-ai/rulecast\n    rev: v0.8.2\n    hooks:\n      - id: rulecast\n",
      "lefthook.yml": "pre-commit:\n  jobs:\n    - name: lint\n      run: eslint\n",
      ".husky/pre-commit": "npx lint-staged\n",
      "hk.pkl": 'hooks { ["pre-commit"] { steps { ["rulecast"] { check = "rulecast run" } } } }\n',
      "backend/app.py": "x = 1\n",
    })
    expect((await facts(root)).gitHooks).toEqual([
      { manager: "pre-commit", file: ".pre-commit-config.yaml", rulecast: true },
      { manager: "lefthook", file: "lefthook.yml", rulecast: false },
      { manager: "hk", file: "hk.pkl", rulecast: true },
      { manager: "husky", file: ".husky/", rulecast: false },
    ])
    // Read at the git top, named from the package.
    expect((await facts(path.join(root, "backend"))).gitHooks[0]).toEqual({
      manager: "pre-commit",
      file: "../.pre-commit-config.yaml",
      rulecast: true,
    })
  })

  test("ci finds claude-code-action and claude -p in workflows, nothing in a plain test workflow", async () => {
    const root = await createRepo({
      ".github/workflows/claude.yml": "jobs:\n  a:\n    steps:\n      - uses: anthropics/claude-code-action@v1\n",
      ".github/workflows/nightly.yaml": "jobs:\n  a:\n    steps:\n      - run: claude -p 'fix the tests'\n",
      ".github/workflows/review.yml": "jobs:\n  a:\n    steps:\n      - run: codex exec 'review'\n",
      ".github/workflows/test.yml": "jobs:\n  a:\n    steps:\n      - run: pytest\n",
    })
    expect((await facts(root)).ci).toEqual([
      { file: ".github/workflows/claude.yml", agent: "claude-code" },
      { file: ".github/workflows/nightly.yaml", agent: "claude-code" },
      { file: ".github/workflows/review.yml", agent: "codex" },
    ])
  })
})
