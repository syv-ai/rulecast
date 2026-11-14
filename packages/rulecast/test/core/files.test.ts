import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, test } from "vitest"

import {
  clearShebangCache,
  compileFilter,
  type FileFilter,
  type FileFilterInput,
  KNOWN_TAGS,
  shebangReads,
  tagsAt,
  tagsOf,
} from "../../src/core/files"

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
    expect([...tagsOf("notes.txt")].sort()).toEqual(["file", "plain-text", "text"])
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

describe("file types as pre-commit's identify (2.6) gives them (AIP)", () => {
  test("identify's other extensions and file names for the tags rulecast has", () => {
    const tags = (file: string) => [...tagsOf(file)].filter((tag) => tag !== "file" && tag !== "text").sort()
    expect(tags("app/wsgi.WSGI")).toEqual(["python"])
    expect(tags("tools/wscript")).toEqual(["python"])
    expect(tags("bin/run.bash")).toEqual(["shell"])
    expect(tags("test/a.bats")).toEqual(["shell"])
    expect(tags(".envrc")).toEqual(["shell"])
    expect(tags("docs/guide.markdown")).toEqual(["markdown"])
    expect(tags("site/index.htm")).toEqual(["html"])
    expect(tags("nb/explore.ipynb")).toEqual(["json"])
    expect(tags("Cargo.toml")).toEqual(["toml"])
    expect(tags("Pipfile")).toEqual(["toml"])
    expect(tags("poetry.lock")).toEqual(["toml"])
    expect(tags("Pipfile.lock")).toEqual(["json"])
    // identify takes a file name part before an extension: README.md is plain text and Markdown.
    expect(tags("README.md")).toEqual(["markdown", "plain-text"])
    expect(tags("LICENSE")).toEqual(["plain-text"])
    // A name identify knows by tags rulecast lacks has none here, and no shebang is read for it.
    expect([...tagsOf("Dockerfile")]).toEqual(["file"])
  })

  describe("a file with no type by its name: its shebang, when it is executable", () => {
    let root = ""
    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), "rulecast-shebang-"))
      clearShebangCache()
    })
    const script = async (name: string, text: string, mode = 0o755) => {
      await writeFile(path.join(root, name), text)
      await chmod(path.join(root, name), mode)
    }
    const typed = (types: string[]) => compileFilter({ ...ALL, typesOr: types, root }) as FileFilter

    test("python, shell and node interpreters, through env and with versions", async () => {
      await script("manage", "#!/usr/bin/env python3\nprint(1)\n")
      await script("versioned", "#!/opt/python/bin/python3.12 -u\n")
      await script("split", "#!/usr/bin/env -S python3 -X dev\n")
      await script("deploy", "#!/bin/bash\nset -e\n")
      await script("zsh-tool", "#! /bin/zsh\n")
      await script("cli", "#!/usr/bin/env node\n")
      const python = typed(["python"])
      expect(["manage", "versioned", "split"].filter(python)).toEqual(["manage", "versioned", "split"])
      expect(python("deploy")).toBe(false)
      expect(["deploy", "zsh-tool"].filter(typed(["shell"]))).toEqual(["deploy", "zsh-tool"])
      expect(typed(["javascript"])("cli")).toBe(true)
      expect(tagsAt(root, "manage").has("python")).toBe(true)
    })

    test("not read for a file typed by its name, one that is not executable, or one that is not there", async () => {
      await script("plain", "#!/usr/bin/env python3\n", 0o644)
      await script("tool.md", "#!/usr/bin/env python3\n")
      await script("perl-tool", "#!/usr/bin/perl\n")
      await mkdir(path.join(root, "dir"))
      const python = typed(["python"])
      expect(["plain", "tool.md", "perl-tool", "dir", "missing"].filter(python)).toEqual([])
    })

    test("as identify reads them: nix-shell's -i on a later #! line, and a quoted interpreter path", async () => {
      await script("nix", "#!/usr/bin/env nix-shell\n#! nix-shell -i python3 -p python3\nprint(1)\n")
      await script("nix-bash", "#!/usr/bin/env nix-shell\n#!nix-shell -i bash\n")
      await script("quoted", '#!"/opt/my py/bin/python" -u\n')
      expect(["nix", "quoted"].filter(typed(["python"]))).toEqual(["nix", "quoted"])
      expect(typed(["shell"])("nix-bash")).toBe(true)
    })

    test("no shebang is read for an extension identify knows, though rulecast has no type for it", async () => {
      await script("deploy.rb", "#!/bin/sh\n")
      await script("tool.c", "#!/usr/bin/env python3\n")
      expect(["deploy.rb", "tool.c"].filter(typed(["shell", "python"]))).toEqual([])
    })

    test("a symlink has no type, as identify gives it none: an exclude_types never leaves it out", async () => {
      await writeFile(path.join(root, "AGENTS.md"), "# Agents\n")
      await symlink("AGENTS.md", path.join(root, "CLAUDE.md"))
      await writeFile(path.join(root, "a.py"), "x = 1\n")
      await symlink("a.py", path.join(root, "link.py"))
      const notMarkdown = compileFilter({ ...ALL, excludeTypes: ["markdown"], root }) as FileFilter
      expect(["AGENTS.md", "CLAUDE.md"].filter(notMarkdown)).toEqual(["CLAUDE.md"])
      expect(["a.py", "link.py"].filter(typed(["python"]))).toEqual(["a.py"])
      // A rule with no type tags takes it, as every file.
      expect((compileFilter({ ...ALL, root }) as FileFilter)("CLAUDE.md")).toBe(true)
      // A file that is not there (deleted, not written yet) is typed by its path.
      expect(typed(["python"])("gone.py")).toBe(true)
    })

    test("a filter with no type tags never reads a file", async () => {
      await script("manage", "#!/usr/bin/env python3\n")
      const files = compileFilter({ ...ALL, files: "^man", root }) as FileFilter
      expect(files("manage")).toBe(true)
      expect(shebangReads()).toBe(0)
      expect(typed(["python"])("manage")).toBe(true)
      expect(typed(["python"])("manage")).toBe(true)
      // Read once per file, then cached.
      expect(shebangReads()).toBe(1)
    })
  })
})
