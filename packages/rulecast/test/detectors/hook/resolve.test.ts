import { describe, expect, test } from "vitest"

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
    expect(await findPreCommitHook(root, "mypy")).toEqual({ id: "mypy", stage: "pre-commit" })
    expect(await findPreCommitHook(root, "slow-check")).toEqual({ id: "slow-check", stage: "pre-push" })
    expect(await findPreCommitHook(root, "lint-alias")).toEqual({ id: "lint-alias", stage: "pre-commit" })
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
