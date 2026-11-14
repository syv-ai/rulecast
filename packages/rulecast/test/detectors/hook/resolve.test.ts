import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { findLefthookJob, findPreCommitHook, substituteFiles } from "../../../src/detectors/hook/resolve"
import { createProject } from "../../helpers/project"

const CONFIG = `
default_stages: [pre-commit]
repos:
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.18.0
    hooks:
      - id: mypy
        args: [--show-column-numbers]
  - repo: local
    hooks:
      - id: slow-check
        name: slow
        entry: ./slow.sh
        language: system
        stages: [pre-push]
      - id: lint
        alias: lint-alias
        entry: ./lint.sh
        language: system
`

describe("findPreCommitHook", () => {
  test("finds a hook id in any repo, with the stage it runs at", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG })
    // mirrors-mypy is not in any cache here: whether it gets its files is unknown, so taken as not.
    expect(await findPreCommitHook(root, "mypy")).toEqual({ id: "mypy", stage: "pre-commit", givenFiles: false })
    expect(await findPreCommitHook(root, "slow-check")).toEqual({
      id: "slow-check",
      stage: "pre-push",
      givenFiles: true,
    })
    expect(await findPreCommitHook(root, "lint-alias")).toEqual({
      id: "lint-alias",
      stage: "pre-commit",
      givenFiles: true,
    })
  })

  test("an unknown id, or no config, is null", async () => {
    const root = await createProject({ ".pre-commit-config.yaml": CONFIG })
    expect(await findPreCommitHook(root, "nope")).toBeNull()
    expect(await findPreCommitHook(await createProject({}), "mypy")).toBeNull()
  })
})

describe("findLefthookJob", () => {
  const dump = {
    "pre-commit": {
      jobs: [
        {
          name: "fix-then-check",
          group: { jobs: [{ name: "biome", run: "biome check --write {staged_files}" }] },
        },
        { name: "typecheck", run: "pnpm typecheck", root: "packages/app/" },
      ],
    },
    "pre-push": { commands: { test: { run: "pnpm test" } } },
  }

  test("a job by name, inside groups too, and an old-style command", () => {
    expect(findLefthookJob(dump, "pre-commit/biome")).toEqual({ run: "biome check --write {staged_files}", root: "" })
    expect(findLefthookJob(dump, "pre-commit/typecheck")).toEqual({ run: "pnpm typecheck", root: "packages/app" })
    expect(findLefthookJob(dump, "pre-push/test")).toEqual({ run: "pnpm test", root: "" })
  })

  test("an unknown hook or job, or a group, is null", () => {
    expect(findLefthookJob(dump, "pre-commit/nope")).toBeNull()
    expect(findLefthookJob(dump, "commit-msg/x")).toBeNull()
    expect(findLefthookJob(dump, "pre-commit/fix-then-check")).toBeNull()
  })
})

describe("substituteFiles", () => {
  test("each file template becomes the files, shell-quoted", () => {
    expect(substituteFiles("lint {staged_files} && fmt {files} {all_files} {push_files}", ["a.ts", "it's.ts"])).toBe(
      "lint 'a.ts' 'it'\\''s.ts' && fmt 'a.ts' 'it'\\''s.ts' 'a.ts' 'it'\\''s.ts' 'a.ts' 'it'\\''s.ts'",
    )
  })

  test("a command without a template is run as it is", () => {
    expect(substituteFiles("pnpm typecheck", ["a.ts"])).toBe("pnpm typecheck")
  })
})

describe("findPreCommitHook: whether a remote hook gets its files, from its manifest", () => {
  const GITLEAKS = "https://github.com/gitleaks/gitleaks"
  const config = (hook: string) => `repos:
  - repo: ${GITLEAKS}
    rev: v8.28.0
    hooks:
${hook}
`
  const MANIFEST =
    "- id: gitleaks\n  entry: gitleaks git --pre-commit\n  pass_filenames: false\n- id: plain\n  entry: plain\n"
  let home = ""

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "rulecast-precommit-home-"))
    vi.stubEnv("XDG_CACHE_HOME", home)
    vi.stubEnv("PRE_COMMIT_HOME", "")
    vi.stubEnv("PREK_HOME", "")
    return () => vi.unstubAllEnvs()
  })

  /** pre-commit's clone of the repo at a rev: its FETCH_HEAD names both. */
  async function preCommitClone(rev: string): Promise<void> {
    const dir = path.join(home, "pre-commit", "repoabc123")
    await mkdir(path.join(dir, ".git"), { recursive: true })
    await writeFile(path.join(dir, ".git", "FETCH_HEAD"), `0123abcd\t\ttag '${rev}' of ${GITLEAKS}\n`)
    await writeFile(path.join(dir, ".pre-commit-hooks.yaml"), MANIFEST)
  }

  test("pre-commit's clone at the config's rev says the hook takes no file names", async () => {
    await preCommitClone("v8.28.0")
    const root = await createProject({ ".pre-commit-config.yaml": config("      - id: gitleaks\n      - id: plain") })
    expect((await findPreCommitHook(root, "gitleaks"))?.givenFiles).toBe(false)
    expect((await findPreCommitHook(root, "plain"))?.givenFiles).toBe(true)
  })

  test("prek's clone counts too", async () => {
    const dir = path.join(home, "prek", "repos", "0321a11f464e05f4")
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, ".prek-repo.json"), JSON.stringify({ repo: GITLEAKS, rev: "v8.28.0" }))
    await writeFile(path.join(dir, ".pre-commit-hooks.yaml"), MANIFEST)
    const root = await createProject({ ".pre-commit-config.yaml": config("      - id: gitleaks\n      - id: plain") })
    expect((await findPreCommitHook(root, "gitleaks"))?.givenFiles).toBe(false)
    expect((await findPreCommitHook(root, "plain"))?.givenFiles).toBe(true)
  })

  test("a clone at another rev, or none, leaves it unknown: not given", async () => {
    await preCommitClone("v8.0.0")
    const root = await createProject({ ".pre-commit-config.yaml": config("      - id: plain") })
    expect((await findPreCommitHook(root, "plain"))?.givenFiles).toBe(false)
  })

  test("the config's own pass_filenames and always_run decide without a manifest", async () => {
    const root = await createProject({
      ".pre-commit-config.yaml": config(
        "      - id: plain\n        pass_filenames: true\n        always_run: false\n      - id: gitleaks\n        always_run: true",
      ),
    })
    expect((await findPreCommitHook(root, "plain"))?.givenFiles).toBe(true)
    expect((await findPreCommitHook(root, "gitleaks"))?.givenFiles).toBe(false)
  })
})
