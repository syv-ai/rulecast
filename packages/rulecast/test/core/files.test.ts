import { describe, expect, test } from "vitest"

import { compileFilter, type FileFilter, type FileFilterInput, KNOWN_TAGS, tagsOf } from "../../src/core/files"

const ALL: FileFilterInput = { files: "", exclude: "^$", types: ["file"], typesOr: [], excludeTypes: [] }

function filter(overrides: Partial<FileFilterInput>): FileFilter {
  const result = compileFilter({ ...ALL, ...overrides })
  if (typeof result === "string") throw new Error(result)
  return result
}

describe("tagsOf", () => {
  test("tags by extension, ignoring case; every file is a file", () => {
    expect([...tagsOf("app/main.py")].sort()).toEqual(["file", "python", "text"])
    expect([...tagsOf("src/Card.TSX")].sort()).toEqual(["file", "text", "tsx"])
    expect([...tagsOf(".github/ci.yml")].sort()).toEqual(["file", "text", "yaml"])
    expect([...tagsOf("Makefile")]).toEqual(["file"])
    expect([...tagsOf(".gitignore")]).toEqual(["file"])
  })

  test("ts and tsx are separate tags, as in pre-commit", () => {
    expect(tagsOf("a.ts").has("tsx")).toBe(false)
    expect(tagsOf("a.tsx").has("ts")).toBe(false)
  })

  test("KNOWN_TAGS has file and every table tag", () => {
    for (const tag of ["file", "text", "python", "ts", "tsx", "javascript", "jsx", "markdown", "yaml", "json"]) {
      expect(KNOWN_TAGS.has(tag)).toBe(true)
    }
  })
})

describe("compileFilter", () => {
  test("the defaults match every file", () => {
    expect(filter({})("any/path/at/all.bin")).toBe(true)
  })

  test("files and exclude are searched in the path, not anchored", () => {
    const services = filter({ files: "services/", exclude: "\\.test\\.py$" })
    expect(services("app/services/users.py")).toBe(true)
    expect(services("app/services/users.test.py")).toBe(false)
    expect(services("app/routes/users.py")).toBe(false)

    const anchored = filter({ files: "^frontend/src/client/" })
    expect(anchored("frontend/src/client/sdk.gen.ts")).toBe(true)
    expect(anchored("other/frontend/src/client/sdk.gen.ts")).toBe(false)
  })

  test("types needs all tags, types_or at least one, exclude_types none", () => {
    const python = filter({ types: ["text", "python"] })
    expect(python("a.py")).toBe(true)
    expect(python("a.ts")).toBe(false)

    const typescript = filter({ typesOr: ["ts", "tsx"] })
    expect(typescript("a.ts")).toBe(true)
    expect(typescript("a.tsx")).toBe(true)
    expect(typescript("a.js")).toBe(false)

    const notDocs = filter({ excludeTypes: ["markdown"] })
    expect(notDocs("README.md")).toBe(false)
    expect(notDocs("a.py")).toBe(true)
  })

  test("reports invalid regexes and unknown tags", () => {
    expect(compileFilter({ ...ALL, files: "(" })).toMatch(/^files: invalid regex: /)
    expect(compileFilter({ ...ALL, exclude: "[" })).toMatch(/^exclude: invalid regex: /)
    expect(compileFilter({ ...ALL, types: ["pyhton"] })).toBe('unknown file type "pyhton"')
    expect(compileFilter({ ...ALL, typesOr: ["tsxx"] })).toBe('unknown file type "tsxx"')
    expect(compileFilter({ ...ALL, excludeTypes: ["md"] })).toBe('unknown file type "md"')
  })
})
