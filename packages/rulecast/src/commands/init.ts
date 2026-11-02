import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { parse } from "yaml"

import { ADAPTERS, adapterByName } from "../adapters"
import { conventionsFor } from "../core/config/conventions"
import { CONFIG_FILE, parseConfig } from "../core/config/load"
import { type Config, defaultConfig } from "../core/config/schema"
import { readSourceFile } from "../core/detection/per-rule"
import type { DetectorRegistry } from "../core/detection/registry"
import { errorMessage } from "../core/errors"
import { allFiles, repositoryTop } from "../core/git"
import { cacheHome } from "../core/home"
import { type Adapter, type InstallScope, LLM_PROVIDERS, type LlmProviderName } from "../core/types"
import type { ConfigSettings } from "../init/config-text"
import { type Detection, detectionSummary, detectProject, markerExists } from "../init/detect"
import { type HookScan, hookRule, notOfferedLines, scanHooks } from "../init/hooks"
import { type AgentChoice, type PlannedChange, planInit, reviewText } from "../init/plan"
import { fetchHookRepos, hookConfigs, settingsDir } from "./install"
import type { CliIo } from "./main"
import { UsageError } from "./usage"
import { validationReport } from "./validate"

const NO_HOOKS = "No agent hooks: rulecast will not run in your agent until you run rulecast install --agent <name>."

const SCOPES: readonly InstallScope[] = ["shared", "personal"]

interface Flags {
  agents: Adapter[]
  /** --no-agents: install no hooks, whatever is detected. */
  noAgents: boolean
  scope: InstallScope
  /** --hooks: the project's own hooks to run as rules, by the ids the dry run offers. */
  hooks: string[]
  settings: ConfigSettings
  dryRun: boolean
  format: "terminal" | "json"
}

const installable = () => ADAPTERS.filter((adapter) => adapter.install !== null)

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

function parseFlags(args: string[]): Flags {
  const { values } = parseArgs({
    args,
    options: {
      agent: { type: "string", multiple: true },
      "no-agents": { type: "boolean", default: false },
      scope: { type: "string" },
      hooks: { type: "string" },
      "llm-model": { type: "string" },
      "llm-provider": { type: "string" },
      conventions: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      format: { type: "string", default: "terminal" },
    },
  })
  if (values.agent !== undefined && values["no-agents"]) throw new UsageError("use --agent or --no-agents, not both")
  const scope = values.scope ?? "shared"
  if (!SCOPES.includes(scope as InstallScope)) throw new UsageError(`unknown scope "${scope}" (use shared or personal)`)
  if (values.format !== "terminal" && values.format !== "json") {
    throw new UsageError(`unknown format "${values.format}" (use terminal or json)`)
  }
  const provider = values["llm-provider"]
  if (provider !== undefined && !LLM_PROVIDERS.includes(provider as LlmProviderName)) {
    throw new UsageError(`unknown llm provider "${provider}" (use ${LLM_PROVIDERS.join(", ")})`)
  }
  if (values.conventions !== undefined && path.isAbsolute(values.conventions)) {
    throw new UsageError("--conventions takes a path relative to the config's directory")
  }
  const agents = (values.agent ?? []).map((name) => {
    const adapter = adapterByName(name)
    if (!adapter?.install) {
      const names = installable().map((each) => each.name)
      throw new UsageError(`unknown agent "${name}" (use ${names.join(", ")})`)
    }
    return adapter
  })
  return {
    agents,
    noAgents: values["no-agents"],
    scope: scope as InstallScope,
    hooks: list(values.hooks),
    settings: {
      conventions: values.conventions ?? null,
      llmModel: values["llm-model"]?.trim() || null,
      llmProvider: provider ?? null,
    },
    dryRun: values["dry-run"],
    format: values.format,
  }
}

async function readConfig(root: string): Promise<{ text: string | null; config: Config | null }> {
  const text = await readSourceFile(root, CONFIG_FILE)
  if (text === null) return { text: null, config: null }
  let data: unknown
  try {
    data = parse(text)
  } catch (error) {
    throw new Error(`${CONFIG_FILE}: ${errorMessage(error)} (fix it, then run rulecast init again)`)
  }
  const parsed = parseConfig(data ?? {})
  if (!parsed.ok) throw new Error(`${parsed.message} (fix it, then run rulecast init again)`)
  return { text, config: parsed.value }
}

const idOf = (entry: unknown): string | null => {
  const id = (entry as { id?: unknown } | null)?.id
  return typeof id === "string" ? id : null
}

/** The project's own pre-commit and lefthook hooks, read at the git top as the hook detector does. */
async function projectHooks(root: string): Promise<HookScan> {
  const top = await repositoryTop(root)
  const project = path.relative(top, root).split(path.sep).join("/")
  return scanHooks((file) => readSourceFile(top, file), project)
}

/**
 * The agents `init` installs hooks for unless told otherwise: the detected ones, or — when nothing
 * marks any agent yet — every adapter rulecast has. A project with only an AGENTS.md is the common
 * case, and installing nothing there is the one default that makes rulecast do nothing at all.
 */
export function defaultAgents(detected: readonly string[], adapters: readonly Adapter[]): Adapter[] {
  const found = adapters.filter((adapter) => detected.includes(adapter.name))
  return found.length > 0 ? found : [...adapters]
}

function chooseAgents(detection: Detection, flags: Flags): AgentChoice[] {
  const detected = detection.agents.filter((agent) => agent.adapter !== null).map((agent) => agent.name)
  const chosen = flags.noAgents ? [] : flags.agents.length > 0 ? flags.agents : defaultAgents(detected, installable())
  return chosen.map((adapter) => ({ adapter, scope: flags.scope }))
}

async function write(root: string, changes: readonly PlannedChange[]): Promise<void> {
  for (const change of changes) {
    const file = path.join(root, change.file)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, change.content)
  }
}

/** What `rulecast init --format json` prints: what it found, and what it would write or wrote (plan 20). */
export interface InitReport {
  root: string
  detected: {
    stack: string[]
    /** The first AGENTS.md, else the first standalone CLAUDE.md. */
    primaryDoc: string | null
    docs: { file: string; headings: string[] }[]
    agents: { name: string; label: string; supported: boolean }[]
  }
  hooks: {
    offered: { id: string; name: string; source: string; modifies: boolean; configured: boolean }[]
    skipped: { name: string; source: string; reason: string }[]
  }
  config: {
    exists: boolean
    /** Where new conventions go, from this config or one above it; null when none names it. */
    conventions: { path: string; from: string } | null
    llm: { model: string | null; provider: string }
  }
  changes: { file: string; created: boolean; commit: boolean; summary: string; content: string }[]
  notes: string[]
  written: boolean
  validate: { errors: number; lines: string[] } | null
}

/**
 * rulecast init (plan 20): the agent runs it after the developer approved the setup, with the
 * interview's answers as flags. It writes the config and the agent hooks at once; `--dry-run` shows
 * what it found and every file it would write, which is what the setup page previews.
 */
export async function initCommand(args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const flags = parseFlags(args)
  // The project is where init runs: its config there, or a new one. Its hooks go there too, where
  // sessions start (install.ts settingsDir).
  const root = settingsDir(io.cwd)
  const home = cacheHome(io.env)

  const { text: configText, config } = await readConfig(root)
  const files = await allFiles(root)
  const detection = await detectProject({
    files,
    read: (file) => readSourceFile(root, file),
    exists: markerExists(root),
    adapters: ADAPTERS,
  })

  const scan = await projectHooks(root)
  const local = config?.repos.find((repo) => repo.repo === "local")
  const configured = new Set((local?.rules ?? []).map(idOf).filter((id): id is string => id !== null))
  const unknown = flags.hooks.find((id) => !scan.offered.some((hook) => hook.id === id))
  if (unknown !== undefined) {
    const offered = scan.offered.map((hook) => hook.id)
    throw new UsageError(
      `"${unknown}" is not a hook offered here (${offered.length === 0 ? "none are" : `offered: ${offered.join(", ")}`})`,
    )
  }
  const hooks = scan.offered.filter((hook) => flags.hooks.includes(hook.id) && !configured.has(hook.id)).map(hookRule)
  const agents = chooseAgents(detection, flags)

  // The hooks serve every config a session started here reaches, as rulecast install's do.
  const own = config ?? defaultConfig()
  const notes: string[] = []
  // Another config that does not load is not this one's to fix: said, and left out of the hooks' timeout.
  const reached = await hookConfigs(root, "init", own, (problem) =>
    notes.push(`${problem}\nLeft out of the hooks' timeout and repo fetch.`),
  )
  const changes = await planInit(
    { agents, hooks, settings: flags.settings },
    {
      configText,
      verifyMs: reached.verifyMs,
      local: existsSync(path.join(root, "node_modules", ".bin", "rulecast")),
      readText: (file) => readSourceFile(root, file),
    },
  )
  if (agents.length === 0) notes.push(NO_HOOKS)
  // Hook rules from a config above the project cite nothing: their findings come without a doc section.
  const uncited = hooks.filter((hook) => hook.context.length === 0).length
  if (uncited > 0) {
    notes.push(
      uncited === 1
        ? "1 hook rule cites no doc section: its config is outside this project."
        : `${uncited} hook rules cite no doc section: their config is outside this project.`,
    )
  }

  const report: InitReport = {
    root,
    detected: {
      stack: detection.stack,
      primaryDoc: detection.primaryDoc,
      docs: detection.docs.map((doc) => ({ file: doc.file, headings: doc.headings.map((heading) => heading.text) })),
      agents: detection.agents.map((agent) => ({
        name: agent.name,
        label: agent.label,
        supported: agent.adapter !== null,
      })),
    },
    hooks: {
      offered: scan.offered.map((hook) => ({
        id: hook.id,
        name: hook.name,
        source: hook.source,
        modifies: hook.modifies,
        configured: configured.has(hook.id),
      })),
      skipped: scan.skipped.map((hook) => ({ name: hook.name, source: hook.source, reason: hook.reason })),
    },
    config: {
      exists: config !== null,
      conventions: await conventionsFor(root),
      llm: { model: own.llm.model, provider: own.llm.provider },
    },
    changes: changes.map(({ file, created, commit, summary, content }) => ({
      file,
      created,
      commit,
      summary,
      content,
    })),
    notes,
    written: false,
    validate: null,
  }

  let fetched = true
  if (!flags.dryRun) {
    await write(root, changes)
    report.written = true
    report.validate = await validationReport(root, home, registry)
    // validate fetched this config's repos; hooks never fetch, so the other configs' are fetched here.
    fetched = await fetchHookRepos(
      reached.configs.filter((each) => each !== own),
      io,
    )
  }

  // \u003c rather than <: the agent pastes this into setup-page.html's script data block, which a
  // literal "</script>" in a file's content would end early.
  if (flags.format === "json") io.stdout(`${JSON.stringify(report, null, 2).replaceAll("<", "\\u003c")}\n`)
  else io.stdout(terminalText(report, detection, scan, report.written ? flags.hooks : []))
  if (report.validate === null) return 0
  return report.validate.errors > 0 || !fetched ? 2 : 0
}

function terminalText(report: InitReport, detection: Detection, scan: HookScan, wrapped: readonly string[]): string {
  const out = [`rulecast init · ${report.root}`, "", "Detected", detectionSummary(detection), ""]
  const offered = report.hooks.offered.filter((hook) => !hook.configured && !wrapped.includes(hook.id))
  if (offered.length > 0 || scan.skipped.length > 0) {
    out.push("Hooks")
    if (offered.length > 0) {
      out.push(
        `Offered as rules with --hooks: ${offered.map((hook) => `${hook.id}${hook.modifies ? " (changes files)" : ""}`).join(", ")}`,
      )
    }
    out.push(...notOfferedLines(scan.skipped), "")
  }
  const planned = report.changes as PlannedChange[]
  out.push(
    report.written ? "Written" : "Would write",
    planned.length === 0 ? "Nothing to change." : reviewText(planned),
  )
  out.push(...report.notes, "")
  if (report.validate !== null) out.push(...report.validate.lines, "")
  const toCommit = report.changes.filter((change) => change.commit).map((change) => change.file)
  if (report.written) out.push(toCommit.length === 0 ? "Done." : `Commit ${toCommit.join(" and ")}.`)
  else out.push("Nothing written (--dry-run).")
  return `${out.join("\n")}\n`
}
