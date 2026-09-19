import { statSync } from "node:fs"
import path from "node:path"

import { type Heading, scanHeadings } from "../core/anchors"
import { tagsOf } from "../core/files"
import type { Adapter } from "../core/types"

export interface DetectedDoc {
  /** Repo-relative, forward slashes. */
  file: string
  headings: Heading[]
  /** The CLAUDE.md that imports this AGENTS.md: the two are one document. */
  importedBy: string | null
}

export interface DetectedAgent {
  name: string
  label: string
  /** null: rulecast has no adapter for this agent yet. */
  adapter: Adapter | null
  /** The marker that was found. */
  marker: string
}

export interface Detection {
  /** Summary labels: "python", "typescript", "javascript", "react". */
  stack: string[]
  /** AGENTS.md files (root first), standalone CLAUDE.md files, then other markdown. */
  docs: DetectedDoc[]
  /** The doc the drafting prompt names: the first AGENTS.md, else the first standalone CLAUDE.md, else null. */
  primaryDoc: string | null
  agents: DetectedAgent[]
}

export interface DetectInput {
  /** Every project file (git ls-files --cached --others --exclude-standard). */
  files: readonly string[]
  /** Reads a repo-relative file; null when missing. */
  read(file: string): Promise<string | null>
  /** Whether a marker exists; a trailing "/" asks for a directory. */
  exists(marker: string): boolean
  adapters: readonly Adapter[]
}

/** Agents rulecast recognises but has no adapter for yet; init lists them as "not supported yet". */
export const KNOWN_AGENTS: readonly { name: string; label: string; markers: string[] }[] = [
  { name: "cursor", label: "Cursor", markers: [".cursor/"] },
  { name: "codex", label: "Codex", markers: [".codex/"] },
]

/** Claude Code's import line for a sibling AGENTS.md. */
const IMPORTS_AGENTS = /^[ \t]*@(\.\/)?AGENTS\.md[ \t]*$/m
const NOT_A_DOC = /^(readme|changelog|license)/i
const AGENT_DOCS = new Set(["AGENTS.md", "CLAUDE.md"])

const basename = (file: string) => path.posix.basename(file)
const segments = (file: string) => file.split("/")
const inNodeModules = (file: string) => segments(file).includes("node_modules")
/** Inside a dot-directory such as .claude/ or .github/: agent and tool configuration, not conventions. */
const inDotDir = (file: string) =>
  segments(file)
    .slice(0, -1)
    .some((segment) => segment.startsWith("."))
/** Root files first, then by path in code-point order. */
const byDepth = (a: string, b: string) => segments(a).length - segments(b).length || (a < b ? -1 : a > b ? 1 : 0)

function usesReact(text: string | null): boolean {
  if (text === null) return false
  try {
    const manifest = JSON.parse(text) as Record<string, unknown>
    return ["dependencies", "devDependencies", "peerDependencies"].some((key) => {
      const dependencies = manifest[key]
      return typeof dependencies === "object" && dependencies !== null && "react" in dependencies
    })
  } catch {
    return false
  }
}

async function detectStack(files: readonly string[], read: DetectInput["read"]): Promise<string[]> {
  const tags = new Set<string>()
  const names = new Set<string>()
  for (const file of files) {
    for (const tag of tagsOf(file)) tags.add(tag)
    names.add(basename(file))
  }
  const stack: string[] = []
  const pythonMarker = names.has("pyproject.toml") || [...names].some((name) => /^requirements.*\.txt$/.test(name))
  if (tags.has("python") || pythonMarker) stack.push("python")
  if (tags.has("ts") || tags.has("tsx")) stack.push("typescript")
  if (tags.has("javascript") || tags.has("jsx")) stack.push("javascript")
  for (const file of files.filter((candidate) => basename(candidate) === "package.json")) {
    if (usesReact(await read(file))) {
      stack.push("react")
      break
    }
  }
  return stack
}

async function detectDocs(files: readonly string[], read: DetectInput["read"]): Promise<DetectedDoc[]> {
  const present = new Set(files)
  const named = (name: string) => files.filter((file) => basename(file) === name).sort(byDepth)
  const importedBy = new Map<string, string>()
  const standalone: string[] = []
  for (const file of named("CLAUDE.md")) {
    const sibling = path.posix.join(path.posix.dirname(file), "AGENTS.md")
    const text = await read(file)
    if (text !== null && present.has(sibling) && IMPORTS_AGENTS.test(text)) importedBy.set(sibling, file)
    else standalone.push(file)
  }
  const others = files
    .filter((file) => {
      const tags = tagsOf(file)
      const name = basename(file)
      return (
        (tags.has("markdown") || tags.has("mdx")) && !AGENT_DOCS.has(name) && !NOT_A_DOC.test(name) && !inDotDir(file)
      )
    })
    .sort()

  const docs: DetectedDoc[] = []
  const add = async (file: string, by: string | null) => {
    const text = await read(file)
    if (text !== null) docs.push({ file, headings: scanHeadings(text), importedBy: by })
  }
  for (const file of named("AGENTS.md")) await add(file, importedBy.get(file) ?? null)
  for (const file of standalone) await add(file, null)
  for (const file of others) await add(file, null)
  return docs
}

function detectAgents(input: DetectInput): DetectedAgent[] {
  const agents: DetectedAgent[] = []
  for (const adapter of input.adapters) {
    const marker = adapter.install?.markers.find((candidate) => input.exists(candidate))
    if (marker !== undefined) agents.push({ name: adapter.name, label: adapter.label, adapter, marker })
  }
  for (const known of KNOWN_AGENTS) {
    const marker = known.markers.find((candidate) => input.exists(candidate))
    if (marker !== undefined) agents.push({ name: known.name, label: known.label, adapter: null, marker })
  }
  return agents
}

/** `DetectInput.exists` for a project on disk. */
export function markerExists(root: string): (marker: string) => boolean {
  return (marker) => {
    try {
      const stat = statSync(path.join(root, marker))
      return !marker.endsWith("/") || stat.isDirectory()
    } catch {
      return false
    }
  }
}

/** Detects the stack, the convention docs and the coding agents of a project. Every result is only a default. */
export async function detectProject(input: DetectInput): Promise<Detection> {
  const files = input.files.filter((file) => !inNodeModules(file))
  const docs = await detectDocs(files, input.read)
  const primary =
    docs.find((doc) => basename(doc.file) === "AGENTS.md") ?? docs.find((doc) => basename(doc.file) === "CLAUDE.md")
  return {
    stack: await detectStack(files, input.read),
    docs,
    primaryDoc: primary?.file ?? null,
    agents: detectAgents(input),
  }
}

/** One line for init's "Detected" step. */
export function detectionSummary(detection: Detection): string {
  const parts = [...detection.stack]
  for (const doc of detection.docs) {
    if (!AGENT_DOCS.has(basename(doc.file))) continue
    parts.push(doc.importedBy === null ? doc.file : `${doc.file} (imported by ${doc.importedBy})`)
  }
  const others = detection.docs.filter((doc) => !AGENT_DOCS.has(basename(doc.file))).length
  if (others > 0) parts.push(`${others} other ${others === 1 ? "doc" : "docs"}`)
  for (const agent of detection.agents) {
    parts.push(`${agent.label} (${agent.marker}${agent.adapter === null ? ", not supported yet" : ""})`)
  }
  return parts.length === 0 ? "nothing yet" : parts.join(" · ")
}

/** Reference choices for a doc: the whole file, then every heading as "file › heading › subheading". */
export function docChoices(doc: DetectedDoc): { value: string; label: string }[] {
  const choices = [{ value: `@${doc.file}`, label: doc.file }]
  const trail: Heading[] = []
  for (const heading of doc.headings) {
    while (trail.length > 0 && trail.at(-1)!.level >= heading.level) trail.pop()
    trail.push(heading)
    // A heading without letters or digits has no slug to point at.
    if (heading.slug === "") continue
    choices.push({
      value: `@${doc.file}#${heading.slug}`,
      label: [doc.file, ...trail.map((entry) => entry.text)].join(" › "),
    })
  }
  return choices
}
