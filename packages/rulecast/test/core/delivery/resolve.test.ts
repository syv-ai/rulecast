import { describe, expect, test } from "vitest"

import { fnv1a } from "../../../src/core/baseline/hash"
import { createReferenceResolver } from "../../../src/core/delivery/resolve"
import { parseReference } from "../../../src/core/references"
import { createProject } from "../../helpers/project"

const PROJECT = { dir: "/project", label: null }

const doc = "# API\n\n## Errors\nMap them.\n\n### Retries\nTwice.\n\n## State\nQueries.\n"

describe("reference resolver", () => {
  test("resolves whole files and sections with hash and size", async () => {
    const root = await createProject({ "conventions/api.md": doc })
    const resolver = createReferenceResolver(root)
    const whole = await resolver.resolve(parseReference("@conventions/api.md", "inject", PROJECT))
    expect(whole).toEqual({
      spec: parseReference("@conventions/api.md", "inject", PROJECT),
      found: true,
      content: doc.trimEnd(),
      hash: fnv1a(doc.trimEnd()),
      bytes: Buffer.byteLength(doc.trimEnd()),
    })
    const section = await resolver.resolve(parseReference("@conventions/api.md#errors", "read", PROJECT))
    expect(section).toMatchObject({ found: true, content: "## Errors\nMap them.\n\n### Retries\nTwice." })
  })

  test("missing files and anchors resolve as not found", async () => {
    const root = await createProject({ "conventions/api.md": doc })
    const resolver = createReferenceResolver(root)
    expect(await resolver.resolve(parseReference("@conventions/nope.md", "inject", PROJECT))).toMatchObject({
      found: false,
    })
    expect(await resolver.resolve(parseReference("@conventions/api.md#nope", "inject", PROJECT))).toMatchObject({
      found: false,
    })
  })

  test("containment: whole file covers sections, sections cover subsections only", async () => {
    const root = await createProject({ "conventions/api.md": doc })
    const resolver = createReferenceResolver(root)
    expect(await resolver.contains("conventions/api.md", null, "retries")).toBe(true)
    expect(await resolver.contains("conventions/api.md", null, null)).toBe(true)
    expect(await resolver.contains("conventions/api.md", "errors", "retries")).toBe(true)
    expect(await resolver.contains("conventions/api.md", "errors", null)).toBe(false)
    expect(await resolver.contains("conventions/api.md", "errors", "state")).toBe(false)
  })

  test("currentHash matches resolve and is null when gone", async () => {
    const root = await createProject({ "conventions/api.md": doc })
    const resolver = createReferenceResolver(root)
    const section = await resolver.resolve(parseReference("@conventions/api.md#state", "inject", PROJECT))
    expect(await resolver.currentHash("conventions/api.md", "state")).toBe(section.found ? section.hash : -1)
    expect(await resolver.currentHash("conventions/gone.md", null)).toBeNull()
  })

  test("resolves rule repo references from their absolute path", async () => {
    const root = await createProject({ "AGENTS.md": "# Project\n" })
    const repo = await createProject({ "docs/errors.md": "# Errors\n\n## Services\nRaise domain errors.\n" })
    const resolver = createReferenceResolver(root)
    const spec = parseReference("@docs/errors.md#services", "inject", { dir: repo, label: "acme/rules@v1" })
    expect(await resolver.resolve(spec)).toMatchObject({ found: true, content: "## Services\nRaise domain errors." })
    expect(await resolver.currentHash(spec.path, "services")).not.toBeNull()
  })
})
