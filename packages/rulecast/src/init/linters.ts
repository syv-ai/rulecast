import path from "node:path"

import { scanHeadings } from "../core/anchors"
import { runTool } from "../core/detection/tool"
import { errorMessage } from "../core/errors"
import { tagsOf } from "../core/files"
import { describeTool, resolveTool } from "../detectors/linter/resolve"
import { TOOL_NAMES, type ToolName } from "../detectors/linter/schema"
import { TOOLS } from "../detectors/linter/tools"
import type { DetectedDoc } from "./detect"
import type { DetectedHook, LocalRule } from "./hooks"

/** A linter the project already runs, as init offers it: one `linter` rule with no `rules:` list. */
export interface DetectedLinter {
  tool: ToolName
  id: `linter/${ToolName}`
  /** The config file that marks it, project-relative: `eslint.config.mjs`, `pyproject.toml`. */
  config: string
  /** The lint rules its config makes errors; null for gitleaks, or when listing them failed (`note`). */
  errorRules: string[] | null
  /** How many rules its config sets to warn, which the rule will not deliver; null when not listed. */
  warningRules: number | null
  /** ruff only: each code's name, so a doc that names the rule by name is found too. */
  names?: Record<string, string>
  /** Why `errorRules` is null, when it is not gitleaks. */
  note?: string
}

/** Past this, a listing is given up on: init must not hang on a slow config. */
const LISTING_TIMEOUT_MS = 5_000

/** The file types a linter's rule selects; none for gitleaks, which looks at every file. */
const TYPES: Record<ToolName, string[] | null> = {
  biome: ["javascript", "jsx", "ts", "tsx"],
  eslint: ["javascript", "jsx", "ts", "tsx"],
  oxlint: ["javascript", "jsx", "ts", "tsx"],
  ruff: ["python"],
  gitleaks: null,
}

const LABEL: Record<ToolName, string> = {
  biome: "Biome",
  eslint: "ESLint",
  oxlint: "oxlint",
  ruff: "Ruff",
  gitleaks: "gitleaks",
}

/** Hook ids that run one of the linters: offered as the linter rule instead. */
const HOOK_TOOL = new Map<string, ToolName>([
  ["ruff", "ruff"],
  ["ruff-check", "ruff"],
  ["eslint", "eslint"],
  ["oxlint", "oxlint"],
  ["gitleaks", "gitleaks"],
  // biomejs/pre-commit's ids, and a local hook's.
  ["biome-check", "biome"],
  ["biome-lint", "biome"],
  ["biome-ci", "biome"],
  ["biome", "biome"],
])

const basename = (file: string) => path.posix.basename(file)
const dirOf = (file: string) => path.posix.dirname(file)
const depth = (file: string) => file.split("/").length

/** The shallowest of `files` that is one of the tool's config files, and really configures it. */
async function configFile(
  tool: ToolName,
  files: readonly string[],
  read: (file: string) => Promise<string | null>,
): Promise<string | null> {
  const markers = new Set(TOOLS[tool].markers)
  const candidates = files
    .filter((file) => markers.has(basename(file)) && !file.split("/").includes("node_modules"))
    .sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1))
  for (const file of candidates) {
    // A pyproject.toml is every Python project's, not only ruff's.
    if (tool === "ruff" && basename(file) === "pyproject.toml" && !/^\[tool\.ruff/m.test((await read(file)) ?? "")) {
      continue
    }
    return file
  }
  return null
}

/** A file under `dir` the tool lints, to ask it what applies there. */
function sampleFile(tool: ToolName, dir: string, files: readonly string[]): string | null {
  const types = TYPES[tool] ?? []
  const prefix = dir === "." ? "" : `${dir}/`
  return (
    files.find(
      (file) =>
        file.startsWith(prefix) &&
        !file.split("/").includes("node_modules") &&
        types.some((type) => tagsOf(file).has(type)),
    ) ?? null
  )
}

interface Listing {
  errorRules: string[]
  warningRules: number
  names?: Record<string, string>
}

/** ESLint's and oxlint's levels: [2, {…}], 2, "error", "deny" are errors; 1, "warn" are warnings. */
function levelOf(value: unknown): "error" | "warning" | null {
  const level = Array.isArray(value) ? value[0] : value
  if (level === 2 || level === "error" || level === "deny") return "error"
  if (level === 1 || level === "warn" || level === "warning") return "warning"
  return null
}

function byLevel(rules: unknown, id: (name: string) => string = (name) => name): Listing {
  if (typeof rules !== "object" || rules === null) throw new Error("no rules in its config")
  const errorRules = new Set<string>()
  let warningRules = 0
  for (const [name, value] of Object.entries(rules)) {
    const level = levelOf(value)
    if (level === "error") errorRules.add(id(name))
    else if (level === "warning") warningRules++
  }
  return { errorRules: [...errorRules].sort(), warningRules }
}

const parseJson = (tool: ToolName, stdout: string): { rules?: unknown } => {
  try {
    return JSON.parse(stdout) as { rules?: unknown }
  } catch {
    throw new Error(`${tool} printed no config`)
  }
}

/** `linter.rules.enabled = [ name (CODE), … ]` from `ruff check --show-settings`. */
export function parseRuffSettings(stdout: string): Listing {
  const block = /^linter\.rules\.enabled = \[\n([\s\S]*?)^\]/m.exec(stdout)
  if (block === null) throw new Error("ruff printed no linter.rules.enabled")
  const names: Record<string, string> = {}
  for (const match of block[1]!.matchAll(/^\s*([\w-]+) \(([A-Z]+[0-9]+)\),?$/gm)) names[match[2]!] = match[1]!
  return { errorRules: Object.keys(names).sort(), warningRules: 0, names }
}

/** The tool's own word on which rules its config makes errors there. */
async function listRules(
  tool: ToolName,
  root: string,
  dir: string,
  files: readonly string[],
  top: string,
  signal: AbortSignal,
): Promise<Listing> {
  const cwd = path.join(root, dir)
  // Never through `uv run`: it syncs the project's environment, and a dry run writes nothing. The
  // project's own node_modules/.bin or .venv, else the tool on the PATH.
  const resolved = await resolveTool(tool, cwd, () => false, top)
  const run = async (args: string[]) =>
    (
      await runTool(resolved.command, [...resolved.prefix, ...args], {
        cwd,
        signal,
        notFound: `${tool} is not installed`,
      })
    ).stdout
  const local = (file: string) => path.posix.relative(dir, file)
  // Biome lists the rules it has on (`biome rage --linter`), not which of them are errors.
  if (tool === "biome") throw new Error("Biome does not say which of its rules are errors")
  if (tool === "oxlint") {
    // oxlint reports a plugin's rule by its bare name (`typescript(no-explicit-any)`): so is it listed.
    return byLevel(parseJson(tool, await run(["--print-config"])).rules, (name) => name.replace(/^[\w-]+\//, ""))
  }
  const sample = sampleFile(tool, dir, files)
  if (sample === null)
    throw new Error(`no ${tool === "ruff" ? "Python" : "JavaScript or TypeScript"} file to ask it about`)
  if (tool === "eslint") return byLevel(parseJson(tool, await run(["--print-config", local(sample)])).rules)
  return parseRuffSettings(await run(["check", "--show-settings", local(sample)]))
}

/**
 * The linters the project already runs: a tool is detected when one of its config files is among
 * `files` and the tool can be run from there. For each, the rules its config makes errors, which
 * is what a `linter` rule without `rules:` delivers.
 */
export async function detectLinters(
  root: string,
  files: readonly string[],
  options: {
    read: (file: string) => Promise<string | null>
    top?: string
    signal?: AbortSignal
    /** Injected by tests: whether a bare command is on PATH. */
    available?: (command: string) => boolean | Promise<boolean>
  },
): Promise<DetectedLinter[]> {
  const top = options.top ?? root
  const found: DetectedLinter[] = []
  for (const tool of TOOL_NAMES) {
    const config = await configFile(tool, files, options.read)
    if (config === null) continue
    const dir = dirOf(config)
    const described = await describeTool(tool, root, {
      top,
      dir: path.join(root, dir),
      ...(options.signal && { signal: options.signal }),
      ...(options.available && { available: options.available }),
    })
    if (!described.found) continue
    const linter: DetectedLinter = { tool, id: `linter/${tool}`, config, errorRules: null, warningRules: null }
    if (tool !== "gitleaks") {
      const signal = AbortSignal.any([
        AbortSignal.timeout(LISTING_TIMEOUT_MS),
        ...(options.signal ? [options.signal] : []),
      ])
      try {
        const listing = await listRules(tool, root, dir, files, top, signal)
        linter.errorRules = listing.errorRules
        linter.warningRules = listing.warningRules
        if (listing.names !== undefined) linter.names = listing.names
      } catch (error) {
        const why = signal.aborted ? `it took over ${LISTING_TIMEOUT_MS / 1000} s` : errorMessage(error)
        linter.note = `${linter.id}: could not list the rules its config makes errors (${why}).`
      }
    }
    found.push(linter)
  }
  return found
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** Escapes a rule id for a pattern. */
const escaped = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** `id` as a whole token: not part of a longer rule id, a scope or a path. */
const tokenOf = (id: string) => new RegExp(`(?<![\\w@/-])${escaped(id)}(?![\\w@/-])`)

/**
 * The doc sections that name each lint rule: the deepest heading whose own lines (up to the next
 * heading of any level) name the id, or ruff's name for a code, as a whole token outside fenced
 * code. Text before a file's first heading is the file's. These are candidates the agent puts to
 * the developer; init never writes one.
 */
export function sectionsNaming(
  docs: readonly DetectedDoc[],
  texts: ReadonlyMap<string, string>,
  ids: readonly string[],
  names?: Record<string, string>,
): { ruleId: string; ref: string }[] {
  const found: { ruleId: string; ref: string }[] = []
  const seen = new Set<string>()
  const patterns = ids.map((ruleId) => ({
    ruleId,
    tokens: [ruleId, ...(names?.[ruleId] ? [names[ruleId]!] : [])].map(tokenOf),
  }))
  for (const doc of docs) {
    const text = texts.get(doc.file)
    if (text === undefined) continue
    const headings = scanHeadings(text)
    const lines = text.split(/\r?\n/)
    let fence: string | null = null
    for (const [index, line] of lines.entries()) {
      const open = FENCE.exec(line)
      if (fence !== null) {
        if (open !== null && open[1]!.startsWith(fence)) fence = null
        continue
      }
      if (open !== null) {
        fence = open[1]!
        continue
      }
      const heading = headings.filter((one) => one.line <= index + 1).at(-1)
      const ref = heading === undefined ? `@${doc.file}` : `@${doc.file}#${heading.slug}`
      for (const { ruleId, tokens } of patterns) {
        const key = `${ruleId}\n${ref}`
        if (seen.has(key) || !tokens.some((token) => token.test(line))) continue
        seen.add(key)
        found.push({ ruleId, ref })
      }
    }
  }
  return found
}

/** The rule init writes for a linter: its errors under the project's own config, with no `rules:` list. */
export function linterRule(linter: DetectedLinter): LocalRule {
  const types = TYPES[linter.tool]
  return {
    id: linter.id,
    name: `${LABEL[linter.tool]} errors`,
    ...(types === null ? {} : { types_or: types }),
    detect: { linter: { tool: linter.tool } },
    message: "{{message}} ({{ruleId}})",
    context: [],
  }
}

/** Marks each hook that runs a detected linter as the same as that linter's rule. */
export function markSameAs(hooks: readonly DetectedHook[], linters: readonly DetectedLinter[]): DetectedHook[] {
  const detected = new Set(linters.map((linter) => linter.tool))
  return hooks.map((hook) => {
    // By its id (`ruff-check`) or its name (`ruff check`, as a local hook calls it).
    const tool =
      HOOK_TOOL.get(hook.id.replace(/^hook\//, "")) ??
      HOOK_TOOL.get(hook.name.trim().toLowerCase().replace(/\s+/g, "-"))
    return tool !== undefined && detected.has(tool) ? { ...hook, sameAs: `linter/${tool}` } : hook
  })
}

/** What `rulecast init --format json` reports for one linter (InitReport.linters). */
export interface OfferedLinter {
  id: string
  tool: ToolName
  config: string
  errorRules: string[] | null
  warningRules: number | null
  configured: boolean
  /** Doc sections that name one of its error rules: mappings to put to the developer, never written. */
  candidates: { ruleId: string; ref: string }[]
}

/** The linters on offer in a project, with the sections that name their error rules. */
export async function offerLinters(
  root: string,
  files: readonly string[],
  docs: readonly DetectedDoc[],
  options: { read: (file: string) => Promise<string | null>; top: string; configured: ReadonlySet<string> },
): Promise<{ detected: DetectedLinter[]; offered: OfferedLinter[]; unoffered: UnofferedLinter[]; notes: string[] }> {
  const detected = await detectLinters(root, files, { read: options.read, top: options.top })
  const unoffered = await unofferedLinters(files, detected, options.read)
  const texts = new Map<string, string>()
  if (detected.some((linter) => (linter.errorRules ?? []).length > 0)) {
    for (const doc of docs) {
      const text = await options.read(doc.file)
      if (text !== null) texts.set(doc.file, text)
    }
  }
  const offered = detected.map((linter) => ({
    id: linter.id,
    tool: linter.tool,
    config: linter.config,
    errorRules: linter.errorRules,
    warningRules: linter.warningRules,
    configured: options.configured.has(linter.id),
    candidates: sectionsNaming(docs, texts, linter.errorRules ?? [], linter.names),
  }))
  return {
    detected,
    offered,
    unoffered,
    notes: detected.flatMap((linter) => (linter.note === undefined ? [] : [linter.note])),
  }
}

/** A linter the project configures that init does not offer as a rule, and why. */
export interface UnofferedLinter {
  /** As people name it: "stylelint", "Biome". */
  tool: string
  /** Its config file, project-relative. */
  config: string
  /** "not supported as a linter rule" or "not installed". */
  reason: string
}

/**
 * Linters rulecast has no `linter` support for, by their config files. A `command` rule can run any
 * of them (agents/reference/tool-recipes.md); init says it found one so the gap is seen (#75).
 */
const UNSUPPORTED: [tool: string, markers: string[]][] = [
  ["golangci-lint", [".golangci.yml", ".golangci.yaml", ".golangci.toml", ".golangci.json"]],
  ["RuboCop", [".rubocop.yml"]],
  [
    "stylelint",
    [
      ".stylelintrc",
      ".stylelintrc.json",
      ".stylelintrc.yml",
      ".stylelintrc.yaml",
      ".stylelintrc.js",
      "stylelint.config.js",
      "stylelint.config.mjs",
      "stylelint.config.cjs",
    ],
  ],
  ["flake8", [".flake8"]],
  ["Pylint", [".pylintrc", "pylintrc"]],
  ["Clippy", ["clippy.toml", ".clippy.toml"]],
  [
    "markdownlint",
    [
      ".markdownlint.json",
      ".markdownlint.jsonc",
      ".markdownlint.yaml",
      ".markdownlint.yml",
      ".markdownlint-cli2.jsonc",
      ".markdownlint-cli2.yaml",
    ],
  ],
  ["hadolint", [".hadolint.yaml", ".hadolint.yml"]],
  ["ShellCheck", [".shellcheckrc"]],
]

/**
 * The linters the project configures that are not offered: one rulecast does not support, or a
 * supported one whose config is there but the tool is not installed. Shallowest config of each.
 */
export async function unofferedLinters(
  files: readonly string[],
  detected: readonly DetectedLinter[],
  read: (file: string) => Promise<string | null>,
): Promise<UnofferedLinter[]> {
  const shallowest = (markers: readonly string[]) =>
    files
      .filter((file) => markers.includes(basename(file)) && !file.split("/").includes("node_modules"))
      .sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1))[0]
  const found: UnofferedLinter[] = []
  for (const tool of TOOL_NAMES) {
    if (detected.some((linter) => linter.tool === tool)) continue
    const config = await configFile(tool, files, read)
    if (config !== null) found.push({ tool: LABEL[tool], config, reason: "not installed" })
  }
  for (const [tool, markers] of UNSUPPORTED) {
    const config = shallowest(markers)
    if (config !== undefined) found.push({ tool, config, reason: "not supported as a linter rule" })
  }
  return found
}

/** init's "Linters" step: the ones on offer, not yet configured or just written, and those not offered. */
export function linterLines(
  offered: readonly OfferedLinter[],
  written: readonly string[],
  unoffered: readonly UnofferedLinter[] = [],
): string[] {
  const open = offered.filter((linter) => !linter.configured && !written.includes(linter.id))
  if (open.length === 0 && unoffered.length === 0) return []
  const lines = ["Linters"]
  if (open.length > 0) {
    lines.push(
      `Offered as rules with --linters: ${open.map((linter) => `${linter.id} (${countsText(linter)})`).join(", ")}`,
    )
  }
  for (const linter of unoffered) lines.push(`Not offered: ${linter.tool} (${linter.config}): ${linter.reason}`)
  if (unoffered.some((linter) => linter.reason !== "not installed")) {
    lines.push("A command rule can run any of them: agents/reference/tool-recipes.md")
  }
  lines.push("")
  return lines
}

/** "12 error rules, 3 warnings not delivered", for init's text. */
function countsText(linter: Pick<DetectedLinter, "tool" | "errorRules" | "warningRules">): string {
  if (linter.tool === "gitleaks") return "every finding"
  if (linter.errorRules === null) return "error rules not listed"
  const errors = `${linter.errorRules.length} error ${linter.errorRules.length === 1 ? "rule" : "rules"}`
  const warnings = linter.warningRules ?? 0
  return warnings === 0 ? errors : `${errors}, ${warnings} ${warnings === 1 ? "warning" : "warnings"} not delivered`
}
