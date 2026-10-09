import { existsSync } from "node:fs"
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { contentReader } from "../../../src/core/content"
import { memoryCache } from "../../../src/core/detection/cache"
import { runDetectionFrom, STAGED_DIR } from "../../../src/core/detection/materialise"
import { createRegistry } from "../../../src/core/detection/registry"
import { type ContentSource, type Detector, type DetectorRun, defaultDetectorSettings } from "../../../src/core/types"
import { createRepo, git } from "../../helpers/git"
import { rule } from "../../helpers/rules"

/** A file whose staged content differs from the working tree. */
async function stagedRepo(): Promise<string> {
  const root = await createRepo({ "app/a.py": "committed\n" })
  await writeFile(path.join(root, "app/a.py"), "staged\n")
  await git(root, "add", "app/a.py")
  await writeFile(path.join(root, "app/a.py"), "worktree\n")
  return root
}

/** Like `command`: hands a path to another program, which reads the file from disk. */
function fromDiskDetector(seen: { file: string; text: string }[]): Detector<unknown> {
  return {
    kind: "disk",
    schema: z.unknown(),
    captures: () => [],
    events: () => ["verify"],
    async run(input) {
      const findings = []
      for (const r of input.rules) {
        for (const file of r.files) {
          const text = await readFile(path.join(input.cwd, file), "utf8")
          seen.push({ file, text })
          findings.push({ rule: r.id, match: { file, line: 1, endLine: 1, column: 1, text, captures: {} } })
        }
      }
      return { findings, errors: [] }
    },
  }
}

function recorder(kind: string, extra: Partial<Detector<unknown>>, runs: DetectorRun<unknown>[]): Detector<unknown> {
  return {
    kind,
    schema: z.unknown(),
    captures: () => [],
    events: () => ["verify"],
    ...extra,
    async run(input) {
      runs.push(input)
      return { findings: [], errors: [] }
    },
  }
}

function input(root: string, source: ContentSource, detectors: Detector<unknown>[], kinds: string[]) {
  return {
    detection: {
      root,
      registry: createRegistry(detectors),
      settings: defaultDetectorSettings(),
      cacheFor: () => memoryCache(),
      contextFor: async () => [],
    },
    event: "verify" as const,
    selections: kinds.map((kind) => ({
      rule: rule({ id: `r/${kind}`, detector: { kind, config: {}, captures: [] } }),
      files: ["app/a.py"],
    })),
    changes: new Map(),
    read: contentReader(root, source),
    timeoutMs: 5000,
  }
}

const scratchDirs = async (root: string) => (await readdir(root)).filter((name) => name.startsWith(STAGED_DIR))

describe("runDetectionFrom", () => {
  test("a detector that reads from disk sees the staged content, under its real path in findings", async () => {
    const root = await stagedRepo()
    const seen: { file: string; text: string }[] = []
    const output = await runDetectionFrom(input(root, { kind: "index" }, [fromDiskDetector(seen)], ["disk"]), {
      kind: "index",
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.text).toBe("staged\n")
    expect(seen[0]!.file.startsWith(STAGED_DIR)).toBe(true)
    expect(output.findings.map((finding) => finding.match.file)).toEqual(["app/a.py"])
    expect(await scratchDirs(root)).toEqual([])
  })

  test("the scratch copy is removed when the detector throws", async () => {
    const root = await stagedRepo()
    const throwing: Detector<unknown> = {
      kind: "boom",
      schema: z.unknown(),
      captures: () => [],
      events: () => ["verify"],
      async run() {
        throw new Error("exploded")
      },
    }
    const output = await runDetectionFrom(input(root, { kind: "index" }, [throwing], ["boom"]), { kind: "index" })
    expect(output.errors.map((error) => error.message)).toEqual(["exploded"])
    expect(await scratchDirs(root)).toEqual([])
  })

  test("guarding and content-taking detectors are run on real paths with fromDisk false", async () => {
    const root = await stagedRepo()
    const runs: DetectorRun<unknown>[] = []
    const detectors = [
      recorder("guarding", { guards: true }, runs),
      recorder("content", { takesContent: () => true }, runs),
    ]
    await runDetectionFrom(input(root, { kind: "index" }, detectors, ["guarding", "content"]), { kind: "index" })
    // One run per kind, both on the real path, both told the content is not on disk.
    expect(runs).toHaveLength(2)
    for (const run of runs) {
      expect(run.fromDisk).toBe(false)
      expect(run.rules.flatMap((r) => r.files)).toEqual(["app/a.py"])
      expect(await run.read("app/a.py")).toBe("staged\n")
    }
  })

  test("a file absent from the source is not checked", async () => {
    const root = await createRepo({ "keep.py": "x\n" })
    await writeFile(path.join(root, "app.py"), "untracked\n")
    const seen: { file: string; text: string }[] = []
    const base = input(root, { kind: "index" }, [fromDiskDetector(seen)], ["disk"])
    base.selections[0]!.files = ["app.py"]
    const output = await runDetectionFrom(base, { kind: "index" })
    expect(seen).toEqual([])
    expect(output.findings).toEqual([])
  })

  test("the working tree runs unchanged, with fromDisk true", async () => {
    const root = await stagedRepo()
    const runs: DetectorRun<unknown>[] = []
    await runDetectionFrom(input(root, { kind: "worktree" }, [recorder("plain", {}, runs)], ["plain"]), {
      kind: "worktree",
    })
    expect(runs[0]!.fromDisk).toBe(true)
    expect(runs[0]!.rules[0]!.files).toEqual(["app/a.py"])
    expect(existsSync(path.join(root, "app/a.py"))).toBe(true)
  })
})
