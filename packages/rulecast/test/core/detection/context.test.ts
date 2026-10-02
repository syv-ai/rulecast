import path from "node:path"
import { describe, expect, test } from "vitest"

import { compile } from "../../../src/core/compile/project"
import { createReferenceResolver } from "../../../src/core/delivery/resolve"
import { detectorCacheDir } from "../../../src/core/detection/cache"
import { detectionFor } from "../../../src/core/detection/context"
import { createRegistry } from "../../../src/core/detection/registry"
import { cachedRepos } from "../../../src/core/repos/provider"
import { builtinDetectors } from "../../../src/detectors"
import { TEST_HOME } from "../../helpers/home"
import { createProject } from "../../helpers/project"

/**
 * The context is behaviour-preserving plumbing, so the real coverage is the rest of the suite: six
 * call sites used to assemble this by hand and every one of them still has its own tests. What is
 * worth asserting here is the two things a caller cannot see from the outside — that the cache lands
 * in the project's state directory rather than somewhere else, and that `contextFor` goes through the
 * resolver it was given.
 */
describe("detectionFor", () => {
  const registry = createRegistry([...builtinDetectors])

  const compiled = async () => {
    const root = await createProject({
      "docs/conventions.md": "# Conventions\n\n## Errors\n\nHandle them.\n",
    })
    const project = await compile({ root, registry, repos: cachedRepos(TEST_HOME) })
    return { root, project }
  }

  test("caches land in the project's state directory, one per kind", async () => {
    const { project } = await compiled()
    const stateDir = path.join(project.root, ".state")
    const detection = detectionFor(project, registry, stateDir, createReferenceResolver(project.root))

    // Written out six times before this module existed, as
    // diskCache(detectorCacheDir(stateDir, kind)).
    await detection.cacheFor("regex").set("k", { v: 1 })
    const { readdir } = await import("node:fs/promises")
    expect(await readdir(detectorCacheDir(stateDir, "regex"))).toHaveLength(1)
    // A different kind is a different directory, so two detectors cannot collide on a key.
    expect(detectorCacheDir(stateDir, "regex")).not.toBe(detectorCacheDir(stateDir, "ast-grep"))
  })

  test("settings carry the project's llm config", async () => {
    const { project } = await compiled()
    const detection = detectionFor(project, registry, "/state", createReferenceResolver(project.root))
    // The literal `settings: { llm: config.llm }` appeared at seven call sites.
    expect(detection.settings).toEqual({ llm: project.config.llm })
  })

  test("contextFor resolves a rule's references through the given resolver", async () => {
    const { project } = await compiled()
    const detection = detectionFor(project, registry, "/state", createReferenceResolver(project.root))
    const resolved = await detection.contextFor({
      ...project.rules[0]!,
      context: [{ ref: "docs/conventions.md#errors", path: "docs/conventions.md", anchor: "errors", mode: "inject" }],
    })
    expect(resolved).toHaveLength(1)
    expect(resolved[0]!.content).toContain("Handle them.")
  })

  test("a rule with no references resolves to nothing", async () => {
    const { project } = await compiled()
    const detection = detectionFor(project, registry, "/state", createReferenceResolver(project.root))
    expect(await detection.contextFor({ ...project.rules[0]!, context: [] })).toEqual([])
  })
})
