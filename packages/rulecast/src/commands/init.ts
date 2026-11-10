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
import { allFiles, isTracked, repositoryTop } from "../core/git"
import { cacheHome } from "../core/home"
import { type Catalog, catalogEntry, groupOf, loadCatalog, PACKS } from "../core/repos/catalog"
import { type Adapter, type InstallScope, LLM_PROVIDERS, type LlmProviderName } from "../core/types"
import type { ConfigSettings, RuleSelection } from "../init/config-text"
import { type Detection, detectionSummary, detectProject, markerExists } from "../init/detect"
import { type SetupFacts, setupFacts } from "../init/facts"
import {
  type FoundPaths,
  filesOverride,
  findGenerated,
  linguistAttributes,
  type OfferedPath,
  readHead,
} from "../init/generated"
import { type HookScan, hookRule, notOfferedLines, scanHooks } from "../init/hooks"
import { linterLines, linterRule, markSameAs, type OfferedLinter, offerLinters } from "../init/linters"
import {
  type AgentChoice,
  type InitSelections,
  type PlannedChange,
  planInit,
  reviewText,
  uncommittedHookFiles,
} from "../init/plan"
import { configLabel, fetchHookRepos, hookConfigs, hooksInstalled, settingsDir } from "./install"
import type { CliIo } from "./main"
import { UsageError } from "./usage"
import { validationReport } from "./validate"

const NO_HOOKS = "No agent hooks: rulecast will not run in your agent until you run rulecast install --agent <name>."
const hooksAboveNote = (labels: string[]) =>
  `No agent hooks here: the hooks in ${labels.join(", ")} reach this config for sessions started there.`

/**
 * The directories above `root`, up to its repository's top, whose agent hooks a session started
 * there would run for this config too (reachableConfigs looks below, in the same work tree).
 */
async function hooksAbove(root: string, verifyMs: number): Promise<string[]> {
  const top = await repositoryTop(root)
  const found: string[] = []
  for (let dir = root; dir !== top && path.dirname(dir) !== dir; ) {
    dir = path.dirname(dir)
    for (const adapter of installable()) {
      if ((await hooksInstalled(dir, adapter, verifyMs).catch(() => null)) !== null) {
        found.push(configLabel(root, dir))
        break
      }
    }
  }
  return found
}

const SCOPES: readonly InstallScope[] = ["shared", "personal"]

interface Flags {
  agents: Adapter[]
  /** --no-agents: install no hooks, whatever is detected. */
  noAgents: boolean
  scope: InstallScope
  /** --hooks: the project's own hooks to run as rules, by the ids the dry run offers. */
  hooks: string[]
  /** --linters: the project's own linters to run as rules, by the ids the dry run offers. */
  linters: string[]
  /** --catalog: catalog rules to adopt, by id. */
  catalog: string[]
  /** --generated / --vendored: paths the dry run offers, covered by generated-code / vendored-code. */
  generated: string[]
  vendored: string[]
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
      linters: { type: "string" },
      catalog: { type: "string" },
      generated: { type: "string" },
      vendored: { type: "string" },
      "llm-model": { type: "string" },
      "llm-provider": { type: "string" },
      conventions: { type: "string" },
      "weekly-summary": { type: "boolean", default: false },
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
    linters: list(values.linters),
    catalog: list(values.catalog),
    generated: list(values.generated),
    vendored: list(values.vendored),
    settings: {
      conventions: values.conventions ?? null,
      llmModel: values["llm-model"]?.trim() || null,
      llmProvider: provider ?? null,
      weeklySummary: values["weekly-summary"],
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

const GENERATED_RULE = "generated-code"
const VENDORED_RULE = "vendored-code"
/** How long the dry run waits for the catalog's tags before it falls back to the cache. */
const TAGS_TIMEOUT_MS = 5000

/** "none are" or "offered: a, b", for a usage error naming what a flag may take. */
const offeredText = (offered: readonly string[]) =>
  offered.length === 0 ? "none are" : `offered: ${offered.join(", ")}`

/**
 * The catalog rules the flags adopt, validated against what init offers. `--generated` and
 * `--vendored` imply their rule, with `files` widened by the paths (filesOverride). A rule the config
 * already lists is left out, unless its `files` lack a path asked for.
 */
function catalogSelections(
  catalog: Catalog,
  flags: Flags,
  found: { generated: OfferedPath[]; vendored: OfferedPath[] },
  listed: readonly unknown[],
): InitSelections["catalog"] {
  for (const id of flags.catalog) {
    if (id in PACKS) throw new UsageError(`"${id}" is a pack: adopt it with rulecast add ${id}`)
    // A pack is adopted whole, with what it is for: never one of its rules at setup.
    const pack = groupOf(id)
    if (pack in PACKS && catalog.rules.some((rule) => rule.id === id)) {
      throw new UsageError(`"${id}" is in the ${pack} pack: adopt the pack with rulecast add ${pack}`)
    }
    if (!catalog.rules.some((rule) => rule.id === id)) {
      const ids = catalog.rules.filter((rule) => !(groupOf(rule.id) in PACKS)).map((rule) => rule.id)
      throw new UsageError(`"${id}" is not a catalog rule in ${catalog.label} (${offeredText(ids)})`)
    }
  }
  // The offered entries, kind included: only an entry offered as a pattern is read as one.
  const paths = new Map<string, OfferedPath[]>()
  for (const [flag, id, chosen, offered] of [
    ["--generated", GENERATED_RULE, flags.generated, found.generated],
    ["--vendored", VENDORED_RULE, flags.vendored, found.vendored],
  ] as const) {
    if (chosen.length === 0) continue
    const unknown = chosen.find((each) => !offered.some((entry) => entry.path === each))
    if (unknown !== undefined) {
      throw new UsageError(
        `"${unknown}" is not a path ${flag} is offered here (${offeredText(offered.map((entry) => entry.path))})`,
      )
    }
    paths.set(
      id,
      chosen.map((each) => offered.find((entry) => entry.path === each)!),
    )
  }

  const rules: RuleSelection[] = []
  for (const id of new Set([...flags.catalog, ...paths.keys()])) {
    const rule = catalog.rules.find((each) => each.id === id)!
    const current = listed.find((item) => idOf(item) === id)
    const chosen = paths.get(id) ?? []
    if (chosen.length === 0) {
      if (current === undefined) rules.push({ id, context: null, files: null })
      continue
    }
    const own = (current as { files?: unknown } | undefined)?.files
    const base = typeof own === "string" ? own : rule.patterns.files
    const missing = chosen.filter((each) => !base.split("|").includes(filesOverride("", [each])))
    if (current !== undefined && missing.length === 0) continue
    rules.push({ id, context: null, files: filesOverride(base, missing) })
  }
  return { ref: { url: catalog.url, rev: catalog.rev }, rules }
}

async function write(root: string, changes: readonly PlannedChange[]): Promise<void> {
  for (const change of changes) {
    const file = path.join(root, change.file)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, change.content)
  }
}

/** One catalog rule as init reports it: how many of the project's files it matches, and whether it is configured. */
export interface CatalogFit {
  id: string
  name: string
  description: string | null
  matching: number
  /** The pack it belongs to: packs are adopted with `rulecast add`, not at setup. */
  pack: string | null
  /** It asks a model: money per file, and the files leave the machine. */
  metered: boolean
  installed: boolean
}

/**
 * What `rulecast init --format json` prints: what it found, and what it would write or wrote (plan 20).
 * Plan 24 adds the facts setup's page of defaults is drawn from.
 */
export interface InitReport {
  root: string
  detected: {
    stack: string[]
    /** The first AGENTS.md, else the first standalone CLAUDE.md. */
    primaryDoc: string | null
    docs: { file: string; headings: string[] }[]
    agents: { name: string; label: string; supported: boolean }[]
    committers: SetupFacts["committers"]
    packages: SetupFacts["packages"]
    sessions: string[]
    gitHooks: SetupFacts["gitHooks"]
    ci: SetupFacts["ci"]
  }
  /**
   * Paths `--generated` / `--vendored` take, beyond what the catalog rules' defaults cover. Empty when
   * the catalog was not loaded or has no `generated-code` / `vendored-code` rule to adopt them with.
   */
  generated: OfferedPath[]
  vendored: OfferedPath[]
  /** Marked files past the listed ones, offered one by one: not listed, only counted. */
  notListed: { generated: number; vendored: number }
  /**
   * The catalog's rules and how each fits; `{ error }` when it could not be loaded. null when it was
   * not needed: a run without --dry-run, --catalog, --generated or --vendored does not load it.
   */
  catalog: { label: string; rules: CatalogFit[] } | { error: string } | null
  hooks: {
    /** modifies: null when the hook runs a script init cannot see into, named by `runs`. */
    offered: {
      id: string
      name: string
      source: string
      modifies: boolean | null
      runs?: string
      configured: boolean
      /** It runs a linter offered under `linters`: that rule is the one to offer. */
      sameAs?: string
    }[]
    skipped: { name: string; source: string; reason: string }[]
  }
  linters: { offered: OfferedLinter[] }
  config: {
    exists: boolean
    /** Where new conventions go, from this config or one above it; null when none names it. */
    conventions: { path: string; from: string } | null
    llm: { model: string | null; provider: string }
    /** stats.weekly_summary: the page's "Weekly stats summary" item is on when this is. */
    stats: { weeklySummary: boolean }
  }
  changes: { file: string; created: boolean; commit: boolean; summary: string; content: string }[]
  /** Files init leaves as they are that still need committing: a hook script that was never added. */
  alsoCommit: string[]
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
  const lintersOn = await offerLinters(root, files, detection.docs, {
    read: (file) => readSourceFile(root, file),
    top: await repositoryTop(root),
    configured,
  })
  const unknownLinter = flags.linters.find((id) => !lintersOn.offered.some((linter) => linter.id === id))
  if (unknownLinter !== undefined) {
    const offered = lintersOn.offered.map((linter) => linter.id)
    throw new UsageError(
      `"${unknownLinter}" is not a linter offered here (${offered.length === 0 ? "none are" : `offered: ${offered.join(", ")}`})`,
    )
  }
  const linters = lintersOn.detected
    .filter((linter) => flags.linters.includes(linter.id) && !configured.has(linter.id))
    .map(linterRule)
  const offeredHooks = markSameAs(scan.offered, lintersOn.detected)
  const agents = chooseAgents(detection, flags)
  const read = (file: string) => readSourceFile(root, file)
  const facts = await setupFacts({ root, files, read, exists: markerExists(root), adapters: ADAPTERS })

  // The catalog, at the rev the config pins, else its latest tag: for the dry run's fit, and for flags that adopt from it.
  const adopts = flags.catalog.length > 0 || flags.generated.length > 0 || flags.vendored.length > 0
  const { url, entry } = catalogEntry(config?.repos ?? [], io.env)
  // Bounded: offline, the dry run uses the newest catalog already in the cache, or reports the error.
  const loaded =
    flags.dryRun || adopts
      ? await loadCatalog(url, entry?.rev, home, registry, { tagsTimeoutMs: TAGS_TIMEOUT_MS, cachedFallback: true })
      : null
  if (typeof loaded === "string" && adopts) throw new Error(`the catalog could not be loaded: ${loaded}`)
  const catalog = typeof loaded === "string" ? null : loaded
  const catalogRule = (id: string) => catalog?.rules.find((rule) => rule.id === id) ?? null
  // Paths are offered only for a rule the loaded catalog has: --generated and --vendored adopt it.
  const generatedRule = catalogRule(GENERATED_RULE)
  const vendoredRule = catalogRule(VENDORED_RULE)
  let linguist: ReturnType<typeof linguistAttributes> | undefined
  const linguistOnce = () => {
    linguist ??= linguistAttributes(root, files)
    return linguist
  }
  const found: FoundPaths =
    generatedRule === null && vendoredRule === null
      ? { generated: [], vendored: [], notListed: { generated: 0, vendored: 0 } }
      : await findGenerated({
          files,
          readHead: (file) => readHead(root, file),
          // One git check-attr for both attributes, asked for once.
          attributed: async (attribute) => (await linguistOnce())[attribute],
          read,
          covered: generatedRule === null ? null : (file) => generatedRule.matches(file),
          coveredVendored: vendoredRule === null ? null : (file) => vendoredRule.matches(file),
        })
  if (generatedRule === null) {
    found.generated = []
    found.notListed.generated = 0
  }
  if (vendoredRule === null) {
    found.vendored = []
    found.notListed.vendored = 0
  }
  const listed = (entry?.rules ?? []) as unknown[]
  const installed = new Set(listed.map(idOf).filter((id): id is string => id !== null))
  const adopted = catalog === null ? null : catalogSelections(catalog, flags, found, listed)

  // The hooks serve every config a session started here reaches, as rulecast install's do.
  const own = config ?? defaultConfig()
  const notes: string[] = [...lintersOn.notes]
  // Another config that does not load is not this one's to fix: said, and left out of the hooks' timeout.
  const reached = await hookConfigs(root, "init", own, (problem) =>
    notes.push(`${problem}\nLeft out of the hooks' timeout and repo fetch.`),
  )
  const planContext = { configText, verifyMs: reached.verifyMs, readText: (file: string) => readSourceFile(root, file) }
  const changes = await planInit({ agents, hooks, linters, catalog: adopted, settings: flags.settings }, planContext)
  const alsoCommit = await uncommittedHookFiles(agents, planContext, (file) => isTracked(root, file))
  if (agents.length === 0) {
    const above = await hooksAbove(root, reached.verifyMs)
    notes.push(above.length > 0 ? hooksAboveNote(above) : NO_HOOKS)
  }
  if (catalog?.offline !== undefined) notes.push(`Catalog: ${catalog.offline}.`)
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
      committers: facts.committers,
      packages: facts.packages,
      sessions: facts.sessions,
      gitHooks: facts.gitHooks,
      ci: facts.ci,
    },
    generated: found.generated,
    vendored: found.vendored,
    notListed: found.notListed,
    catalog:
      loaded === null
        ? null
        : typeof loaded === "string"
          ? { error: loaded }
          : {
              label: loaded.label,
              rules: loaded.rules.map((rule) => ({
                id: rule.id,
                name: rule.name,
                description: rule.description,
                matching: files.filter((file) => rule.matches(file)).length,
                pack: groupOf(rule.id) in PACKS ? groupOf(rule.id) : null,
                metered: rule.detector !== null && registry.get(rule.detector.kind)?.metered === true,
                installed: installed.has(rule.id),
              })),
            },
    hooks: {
      offered: offeredHooks.map((hook) => ({
        id: hook.id,
        name: hook.name,
        source: hook.source,
        modifies: hook.modifies,
        ...(hook.runs === undefined ? {} : { runs: hook.runs }),
        configured: configured.has(hook.id),
        ...(hook.sameAs === undefined ? {} : { sameAs: hook.sameAs }),
      })),
      skipped: scan.skipped.map((hook) => ({ name: hook.name, source: hook.source, reason: hook.reason })),
    },
    linters: { offered: lintersOn.offered },
    config: {
      exists: config !== null,
      conventions: await conventionsFor(root),
      llm: { model: own.llm.model, provider: own.llm.provider },
      stats: { weeklySummary: own.stats.weeklySummary },
    },
    changes: changes.map(({ file, created, commit, summary, content }) => ({
      file,
      created,
      commit,
      summary,
      content,
    })),
    alsoCommit,
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
  else io.stdout(terminalText(report, detection, scan, report.written ? adoptedNames(flags) : []))
  if (report.validate === null) return 0
  return report.validate.errors > 0 || !fetched ? 2 : 0
}

/** The hook and linter ids, catalog rule ids and paths a run wrote: no longer offered in its text. */
function adoptedNames(flags: Flags): string[] {
  return [
    ...flags.hooks,
    ...flags.linters,
    ...flags.catalog,
    ...(flags.generated.length > 0 ? [GENERATED_RULE, ...flags.generated] : []),
    ...(flags.vendored.length > 0 ? [VENDORED_RULE, ...flags.vendored] : []),
  ]
}

/** `wrapped`: what this run wrote (adoptedNames), left out of what it offers. */
function terminalText(report: InitReport, detection: Detection, scan: HookScan, wrapped: readonly string[]): string {
  const out = [`rulecast init · ${report.root}`, "", "Detected", detectionSummary(detection), ""]
  out.push(...linterLines(report.linters.offered, wrapped))
  const offered = report.hooks.offered.filter((hook) => !hook.configured && !wrapped.includes(hook.id))
  if (offered.length > 0 || scan.skipped.length > 0) {
    out.push("Hooks")
    if (offered.length > 0) {
      out.push(`Offered as rules with --hooks: ${offered.map((hook) => `${hook.id}${writesNote(hook)}`).join(", ")}`)
    }
    out.push(...notOfferedLines(scan.skipped), "")
  }
  if (report.catalog !== null && "error" in report.catalog) {
    out.push("Catalog", `Could not be loaded: ${report.catalog.error}`, "")
  } else if (report.catalog !== null) {
    const fitting = report.catalog.rules.filter(
      (rule) => rule.matching > 0 && rule.pack === null && !rule.installed && !wrapped.includes(rule.id),
    )
    if (fitting.length > 0) {
      const named = fitting.map((rule) => `${rule.id} (${plural(rule.matching, "file")}${rule.metered ? ", llm" : ""})`)
      out.push(`Catalog (${report.catalog.label})`, `Fits, with --catalog: ${named.join(", ")}`, "")
    }
  }
  const paths = (flag: string, offered: readonly OfferedPath[], more: number) => {
    const left = offered.filter((entry) => !wrapped.includes(entry.path))
    const named = left.map((entry) =>
      entry.kind === "file" ? entry.path : `${entry.path} (${plural(entry.files, "file")})`,
    )
    const rest = more > 0 ? `, and ${plural(more, "more file")} not listed` : ""
    return left.length === 0 ? [] : [`Offered with ${flag}: ${named.join(", ")}${rest}`]
  }
  const generated = [
    ...paths("--generated", report.generated, report.notListed.generated),
    ...paths("--vendored", report.vendored, report.notListed.vendored),
  ]
  if (generated.length > 0) out.push("Generated", ...generated, "")
  const planned = report.changes as PlannedChange[]
  out.push(
    report.written ? "Written" : "Would write",
    planned.length === 0 ? "Nothing to change." : reviewText(planned),
  )
  out.push(...report.notes, "")
  if (report.validate !== null) out.push(...report.validate.lines, "")
  const toCommit = [
    ...report.changes.filter((change) => change.commit).map((change) => change.file),
    ...report.alsoCommit,
  ]
  if (!report.written) out.push("Nothing written (--dry-run).")
  else if ((report.validate?.errors ?? 0) > 0) out.push("Not ready to commit: fix what validate reports above.")
  else out.push(toCommit.length === 0 ? "Done." : `Commit ${listed(toCommit)}.`)
  return `${out.join("\n")}\n`
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** "a", "a and b", "a, b and c". */
const listed = (items: readonly string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`

/** How init's text says whether an offered hook changes files. */
function writesNote(hook: { modifies: boolean | null; runs?: string; sameAs?: string }): string {
  if (hook.sameAs !== undefined) return ` (same as ${hook.sameAs}: offer that instead)`
  if (hook.modifies === true) return " (changes files)"
  if (hook.modifies === null) return ` (may change files: runs ${hook.runs})`
  return ""
}
