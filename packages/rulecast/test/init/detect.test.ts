import { describe, expect, test } from "vitest"

import { ADAPTERS } from "../../src/adapters"
import { readSourceFile } from "../../src/core/detection/per-rule"
import { type Detection, detectionSummary, detectProject, docChoices, markerExists } from "../../src/init/detect"
import { createProject } from "../helpers/project"

/** Detects a project written from `files`; `dirs` (with a trailing "/") are created empty. */
async function detect(files: Record<string, string>, dirs: string[] = []): Promise<Detection> {
  const root = await createProject({ ...files, ...Object.fromEntries(dirs.map((dir) => [`${dir}.keep`, ""])) })
  return detectProject({
    files: Object.keys(files).sort(),
    read: (file) => readSourceFile(root, file),
    exists: markerExists(root),
    adapters: ADAPTERS,
  })
}

const docFiles = (detection: Detection) => detection.docs.map((doc) => [doc.file, doc.importedBy])

describe("detectProject: docs", () => {
  test("AGENTS.md only", async () => {
    const detection = await detect({ "AGENTS.md": "# Agents\n\n## Errors\n" })
    expect(docFiles(detection)).toEqual([["AGENTS.md", null]])
    expect(detection.primaryDoc).toBe("AGENTS.md")
    expect(detection.docs[0]!.headings.map((heading) => heading.slug)).toEqual(["agents", "errors"])
  })

  test("a CLAUDE.md that imports AGENTS.md is the same document", async () => {
    const detection = await detect({ "AGENTS.md": "# Agents\n", "CLAUDE.md": "# Claude\n\n@AGENTS.md\n" })
    expect(docFiles(detection)).toEqual([["AGENTS.md", "CLAUDE.md"]])
    expect(detection.primaryDoc).toBe("AGENTS.md")
  })

  test("a CLAUDE.md without the import is a doc of its own", async () => {
    const detection = await detect({ "CLAUDE.md": "# Claude\n\n## Rules\n" })
    expect(docFiles(detection)).toEqual([["CLAUDE.md", null]])
    expect(detection.primaryDoc).toBe("CLAUDE.md")
  })

  test("other markdown docs, without READMEs, changelogs, licences, node_modules or dot-directories", async () => {
    const detection = await detect({
      "README.md": "# Readme\n",
      "CHANGELOG.md": "# Changes\n",
      "LICENSE.md": "MIT\n",
      "docs/api.md": "# API\n",
      "docs/README.md": "# Docs readme\n",
      "ways-of-working/backend.md": "# Backend\n",
      "node_modules/pkg/guide.md": "# Guide\n",
      ".claude/commands/review.md": "# Review\n",
    })
    expect(docFiles(detection)).toEqual([
      ["docs/api.md", null],
      ["ways-of-working/backend.md", null],
    ])
    expect(detection.primaryDoc).toBeNull()
  })

  test("nested AGENTS.md files come after the root one, then standalone CLAUDE.md files", async () => {
    const detection = await detect({
      "backend/AGENTS.md": "# Backend\n",
      "backend/CLAUDE.md": "@./AGENTS.md\n",
      "AGENTS.md": "# Root\n",
      "frontend/CLAUDE.md": "# Frontend\n",
      "docs/guide.md": "# Guide\n",
    })
    expect(docFiles(detection)).toEqual([
      ["AGENTS.md", null],
      ["backend/AGENTS.md", "backend/CLAUDE.md"],
      ["frontend/CLAUDE.md", null],
      ["docs/guide.md", null],
    ])
    expect(detection.primaryDoc).toBe("AGENTS.md")
  })
})

describe("detectProject: stack and agents", () => {
  test("python from sources or pyproject.toml; typescript and react from package.json", async () => {
    expect((await detect({ "pyproject.toml": "[project]\n" })).stack).toEqual(["python"])
    const web = await detect({
      "frontend/package.json": JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      "frontend/src/App.tsx": "export {}\n",
      "node_modules/x/index.js": "",
    })
    expect(web.stack).toEqual(["typescript", "react"])
  })

  test("agents with an adapter and known agents without one", async () => {
    const detection = await detect({ "app.py": "" }, [".claude/", ".cursor/"])
    expect(detection.agents.map((agent) => [agent.name, agent.marker, agent.adapter?.name ?? null])).toEqual([
      ["claude-code", ".claude/", "claude-code"],
      ["cursor", ".cursor/", null],
    ])
    expect((await detect({ "CLAUDE.md": "# Claude\n" })).agents.map((agent) => agent.marker)).toEqual(["CLAUDE.md"])
    expect((await detect({ "app.py": "" })).agents).toEqual([])
  })
})

describe("detectionSummary and docChoices", () => {
  test("summarises stack, agent docs, other docs and agents", async () => {
    const detection = await detect(
      { "AGENTS.md": "# A\n", "CLAUDE.md": "@AGENTS.md\n", "docs/a.md": "# A\n", "app.py": "" },
      [".claude/", ".codex/"],
    )
    expect(detectionSummary(detection)).toBe(
      "python · AGENTS.md (imported by CLAUDE.md) · 1 other doc · Claude Code (.claude/) · Codex (.codex/, not supported yet)",
    )
  })

  test("lists the whole file and every heading as a breadcrumb", async () => {
    const detection = await detect({ "AGENTS.md": "# Backend\n\n## Errors\n\n### HTTP\n\n## Services\n\n# !!!\n" })
    expect(docChoices(detection.docs[0]!)).toEqual([
      { value: "@AGENTS.md", label: "AGENTS.md" },
      { value: "@AGENTS.md#backend", label: "AGENTS.md › Backend" },
      { value: "@AGENTS.md#errors", label: "AGENTS.md › Backend › Errors" },
      { value: "@AGENTS.md#http", label: "AGENTS.md › Backend › Errors › HTTP" },
      { value: "@AGENTS.md#services", label: "AGENTS.md › Backend › Services" },
    ])
  })
})
