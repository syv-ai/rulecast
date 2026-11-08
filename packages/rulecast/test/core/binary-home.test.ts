import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { parse } from "yaml"

import { gitHookCommand, probeRulecast } from "../../src/core/binary-home"
import { childEnv, markOwnEnv, unmarkOwnEnv } from "../../src/core/child-env"
import { breakPathRulecast, LOOKUP_FIXTURES, lookupSetup } from "../helpers/lookup"
import { createProject } from "../helpers/project"

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))

const BASE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"

describe("probeRulecast", () => {
  test("a file the OS cannot execute is none, not a crash", async () => {
    const setup = lookupSetup(["path"], await createProject({}))
    expect(await probeRulecast(setup.file.path)).toEqual({ version: "0.8.2" })
    breakPathRulecast(setup)
    expect(await probeRulecast(setup.file.path)).toBeNull()
  })
})

describe("childEnv", () => {
  test("drops what rulecast set for itself, and keeps a value the user set", () => {
    markOwnEnv("NAPI_RS_NATIVE_LIBRARY_PATH", "/ours/napi.node")
    try {
      expect(childEnv({ NAPI_RS_NATIVE_LIBRARY_PATH: "/ours/napi.node", A: "1" })).toEqual({ A: "1" })
      expect(childEnv({ NAPI_RS_NATIVE_LIBRARY_PATH: "/theirs.node" })).toEqual({
        NAPI_RS_NATIVE_LIBRARY_PATH: "/theirs.node",
      })
    } finally {
      unmarkOwnEnv("NAPI_RS_NATIVE_LIBRARY_PATH")
    }
    expect(childEnv({ NAPI_RS_NATIVE_LIBRARY_PATH: "/ours/napi.node" })).toEqual({
      NAPI_RS_NATIVE_LIBRARY_PATH: "/ours/napi.node",
    })
  })
})

describe("gitHookCommand", () => {
  test(".pre-commit-hooks.yaml runs rulecast as the agent hooks find it", () => {
    const hooks = parse(readFileSync(path.join(repoRoot, ".pre-commit-hooks.yaml"), "utf8")) as {
      id: string
      entry: string
    }[]
    expect(Object.fromEntries(hooks.map((hook) => [hook.id, hook.entry]))).toEqual({
      rulecast: gitHookCommand("run"),
      "rulecast-push": gitHookCommand('run --from-ref "$PRE_COMMIT_FROM_REF" --to-ref "$PRE_COMMIT_TO_REF"'),
    })
  })

  test.each(LOOKUP_FIXTURES)(
    "the git-hook resolver prefers the project's, then the PATH, then install.sh's: $name",
    async ({ places, runs }) => {
      const root = await createProject({})
      const { pathDir, installDir } = lookupSetup(places, root)
      // pre-commit's entry is split like a shell would; the command is `sh -c <script> --`.
      const script = gitHookCommand("run").slice("sh -c '".length, -"' --".length)
      const result = spawnSync("/bin/sh", ["-c", script, "--"], {
        cwd: root,
        env: { PATH: `${pathDir}:${BASE_PATH}`, RULECAST_INSTALL_DIR: installDir },
        encoding: "utf8",
      })
      expect(result.stdout).toBe(`{"${runs}":true}\n`)
      expect(readFileSync(path.join(root, `ran-${runs}`), "utf8")).toBe("run\n")
    },
  )
})
