import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { parse } from "yaml"

import { ADAPTERS, adapterByName } from "../adapters"
import { compile, compileManifest } from "../core/compile/project"
import type { CompiledRule } from "../core/compile/rule"
import { CONFIG_FILE, parseConfig } from "../core/config/load"
import { type Config, defaultConfig } from "../core/config/schema"
import { readSourceFile } from "../core/detection/per-rule"
import type { DetectorRegistry } from "../core/detection/registry"
import { errorMessage } from "../core/errors"
import { allFiles } from "../core/git"
import { cacheHome } from "../core/home"
import { ensureRepo } from "../core/repos/fetch"
import { repoLabel } from "../core/repos/layout"
import { fetchingRepos } from "../core/repos/provider"
import { latestTag, remoteTags } from "../core/repos/tags"
import type { Adapter, InstallScope } from "../core/types"
import { VERSION } from "../core/version"
import type { CatalogRef, RuleSelection } from "../init/config-text"
import { type Detection, detectionSummary, detectProject, docChoices, markerExists } from "../init/detect"
import { draftPrompt } from "../init/draft-prompt"
import { type AgentChoice, type PlannedChange, planInit, reviewText } from "../init/plan"
import { Cancelled, type Choice, type Prompter } from "../init/prompts"
import type { CliIo } from "./main"
import { findRoot, hasProject } from "./project"
import { UsageError } from "./usage"

/** The rule catalog: the rulecast repository itself (spec §4, Rule repos). RULECAST_CATALOG overrides it. */
export const DEFAULT_CATALOG = "https://github.com/syv-ai/rulecast"

const SCOPES: readonly InstallScope[] = ["shared", "personal"]

interface Flags {
  /** --rules; null when not given. */
  rules: string[] | null
  noRules: boolean
  agents: Adapter[]
  scope: InstallScope | null
  yes: boolean
}

interface Catalog extends CatalogRef {
  label: string
  rules: CompiledRule[]
}

/** Where init writes to: the output channel differs between prompting and plain runs. */
interface Ui {
  /** null: no prompts; every choice takes its flag or its detected default. */
  prompter: Prompter | null
  say(message: string, title?: string): void
}

const installable = () => ADAPTERS.filter((adapter) => adapter.install !== null)

function parseFlags(args: string[]): Flags {
  const { values } = parseArgs({
    args,
    options: {
      rules: { type: "string" },
      "no-rules": { type: "boolean", default: false },
      agent: { type: "string", multiple: true },
      scope: { type: "string" },
      yes: { type: "boolean", default: false },
    },
  })
  if (values.rules !== undefined && values["no-rules"]) throw new UsageError("use --rules or --no-rules, not both")
  const scope = values.scope ?? null
  if (scope !== null && !SCOPES.includes(scope as InstallScope)) {
    throw new UsageError(`unknown scope "${scope}" (use shared or personal)`)
  }
  const agents = (values.agent ?? []).map((name) => {
    const adapter = adapterByName(name)
    if (!adapter?.install) {
      const names = installable().map((each) => each.name)
      throw new UsageError(`unknown agent "${name}" (use ${names.join(", ")})`)
    }
    return adapter
  })
  const rules =
    values.rules === undefined
      ? null
      : values.rules
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
  return { rules, noRules: values["no-rules"], agents, scope: scope as InstallScope | null, yes: values.yes }
}

/** The configured project, else the enclosing git repository, else the current directory. */
function projectRoot(cwd: string): string {
  const found = findRoot(cwd)
  if (hasProject(found)) return found
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return cwd
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

/** The catalog at the configured rev, else at its latest tag; a message when it cannot be loaded. */
async function loadCatalog(
  url: string,
  rev: string | undefined,
  home: string,
  registry: DetectorRegistry,
): Promise<Catalog | string> {
  try {
    let pinned = rev
    if (pinned === undefined) {
      const tag = latestTag(await remoteTags(url))
      if (tag === null) return `${url} has no version tags`
      pinned = tag.name
    }
    const dir = await ensureRepo(home, url, pinned)
    const { rules } = await compileManifest(dir, registry)
    return { url, rev: pinned, label: repoLabel(url, pinned), rules }
  } catch (error) {
    return errorMessage(error)
  }
}

const idOf = (entry: unknown): string | null => {
  const id = (entry as { id?: unknown } | null)?.id
  return typeof id === "string" ? id : null
}

const groupOf = (id: string) => (id.includes("/") ? id.slice(0, id.indexOf("/")) : "general")

async function chooseRules(
  catalog: Catalog,
  installed: ReadonlySet<string>,
  files: readonly string[],
  flags: Flags,
  ui: Ui,
): Promise<CompiledRule[]> {
  const available = catalog.rules.filter((rule) => !installed.has(rule.id))
  if (flags.noRules) return []
  if (flags.rules !== null) {
    const known = new Set(catalog.rules.map((rule) => rule.id))
    const unknown = flags.rules.find((id) => !known.has(id))
    if (unknown !== undefined) throw new UsageError(`"${unknown}" is not a rule in ${catalog.label}`)
    return available.filter((rule) => flags.rules!.includes(rule.id))
  }
  // Preselected: rules that apply to at least one project file — except llm rules. Spec §6,
  // Consent: an llm rule sends file contents to a third party and costs money per file, so it is
  // never ticked on someone's behalf. It is still offered, and --rules still installs it. This
  // also covers --yes and the no-TTY path, which take `preselected` directly below.
  const preselected = available
    .filter((rule) => rule.detector?.kind !== "llm" && files.some((file) => rule.matches(file)))
    .map((rule) => rule.id)
  if (ui.prompter === null) return available.filter((rule) => preselected.includes(rule.id))
  if (available.length === 0) {
    ui.say(`Every rule from ${catalog.label} is already configured.`, "Rules")
    return []
  }
  const groups: Record<string, Choice[]> = {}
  for (const rule of catalog.rules) {
    const group = groupOf(rule.id)
    const done = installed.has(rule.id)
    const choices = groups[group] ?? []
    choices.push({
      value: rule.id,
      label: group === "general" ? rule.id : rule.id.slice(group.length + 1),
      hint: done ? "installed" : hintFor(rule),
      disabled: done,
    })
    groups[group] = choices
  }
  const chosen = await ui.prompter.groupMultiselect({
    message: `Rules from ${catalog.label}`,
    groups,
    initialValues: preselected,
  })
  return available.filter((rule) => chosen.includes(rule.id))
}

/** An llm rule says what it costs and where the file goes, so ticking it is an informed choice. */
function hintFor(rule: CompiledRule): string {
  const description = rule.description ?? rule.name
  if (rule.detector?.kind !== "llm") return description
  const model = (rule.detector.config as { model?: string }).model ?? "a model"
  return `llm · ${model} · sends file contents to your provider — ${description}`
}

async function chooseConventions(rules: CompiledRule[], detection: Detection, ui: Ui): Promise<RuleSelection[]> {
  const choices = detection.docs.flatMap(docChoices)
  const selections: RuleSelection[] = []
  for (const rule of rules) {
    if (ui.prompter === null || rule.context.length === 0 || choices.length === 0) {
      selections.push({ id: rule.id, context: null })
      continue
    }
    const keep: Choice = {
      value: "",
      label: "keep the package's doc",
      hint: rule.context.map((spec) => spec.ref).join(", "),
    }
    const answer = await ui.prompter.select({
      message: `Conventions for ${rule.id}`,
      choices: [keep, ...choices],
      initialValue: "",
    })
    selections.push({ id: rule.id, context: answer === "" ? null : [answer] })
  }
  return selections
}

async function chooseAgents(detection: Detection, flags: Flags, ui: Ui): Promise<AgentChoice[]> {
  const detected = detection.agents.filter((agent) => agent.adapter !== null).map((agent) => agent.name)
  let chosen: Adapter[]
  if (flags.agents.length > 0) chosen = flags.agents
  else if (ui.prompter === null) chosen = installable().filter((adapter) => detected.includes(adapter.name))
  else {
    const choices: Choice[] = installable().map((adapter) => ({
      value: adapter.name,
      label: adapter.label,
      hint: detected.includes(adapter.name) ? "detected" : undefined,
    }))
    for (const agent of detection.agents) {
      if (agent.adapter === null) {
        choices.push({
          value: `unsupported:${agent.name}`,
          label: agent.label,
          hint: "not supported yet",
          disabled: true,
        })
      }
    }
    const names = await ui.prompter.multiselect({ message: "Install hooks for", choices, initialValues: detected })
    chosen = installable().filter((adapter) => names.includes(adapter.name))
  }
  if (chosen.length === 0) {
    ui.say("No agent hooks will be installed. Add them later with rulecast install --agent <name>.", "Agents")
  }

  const agents: AgentChoice[] = []
  for (const adapter of chosen) {
    let scope: InstallScope = flags.scope ?? "shared"
    if (flags.scope === null && ui.prompter !== null) {
      scope = (await ui.prompter.select({
        message: `${adapter.label} hooks in`,
        choices: adapter.install!.scopes.map((entry) => ({
          value: entry.scope,
          label: `${entry.scope} (${entry.file})`,
        })),
        initialValue: "shared",
      })) as InstallScope
    }
    agents.push({ adapter, scope })
  }
  return agents
}

async function write(root: string, changes: readonly PlannedChange[]): Promise<void> {
  for (const change of changes) {
    const file = path.join(root, change.file)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, change.content)
  }
}

/** rulecast validate on what init wrote; fetches rule repos missing from the cache. Returns the error count. */
async function validate(root: string, home: string, registry: DetectorRegistry, ui: Ui): Promise<number> {
  const project = await compile({ root, registry, repos: fetchingRepos(home) })
  const errors = project.diagnostics.filter((diagnostic) => diagnostic.level === "error")
  const lines = project.diagnostics.map(
    (diagnostic) =>
      `${diagnostic.level === "warning" ? "warning: " : ""}${diagnostic.source}${diagnostic.rule ? ` (${diagnostic.rule})` : ""}: ${diagnostic.message}`,
  )
  if (errors.length === 0) {
    const count = project.rules.length
    lines.push(`rulecast validate: ${count} ${count === 1 ? "rule" : "rules"} valid`)
  }
  ui.say(lines.join("\n"), "Validate")
  return errors.length
}

async function run(root: string, flags: Flags, registry: DetectorRegistry, io: CliIo, ui: Ui): Promise<number> {
  const home = cacheHome(io.env)
  if (ui.prompter !== null) ui.prompter.intro(`rulecast init · ${root}`)
  else io.stdout(`rulecast init · ${root}\n\n`)

  const { text: configText, config } = await readConfig(root)
  const files = await allFiles(root)
  const detection = await detectProject({
    files,
    read: (file) => readSourceFile(root, file),
    exists: markerExists(root),
    adapters: ADAPTERS,
  })
  ui.say(detectionSummary(detection), "Detected")

  const url = io.env.RULECAST_CATALOG || DEFAULT_CATALOG
  const configured = config?.repos.find((repo) => repo.repo === url)
  const loaded = await loadCatalog(url, configured?.rev, home, registry)
  const catalog = typeof loaded === "string" ? null : loaded
  if (typeof loaded === "string") ui.say(`${loaded}. Continuing without catalog rules.`, "Catalog unavailable")
  const installed = new Set((configured?.rules ?? []).map(idOf).filter((id): id is string => id !== null))
  const rules = catalog === null ? [] : await chooseRules(catalog, installed, files, flags, ui)
  const selections = await chooseConventions(rules, detection, ui)
  const agents = await chooseAgents(detection, flags, ui)

  const changes = await planInit(
    { catalog: catalog === null ? null : { url: catalog.url, rev: catalog.rev }, rules: selections, agents },
    {
      configText,
      verifyMs: (config ?? defaultConfig()).timeouts.verifyMs,
      local: existsSync(path.join(root, "node_modules", ".bin", "rulecast")),
      readText: (file) => readSourceFile(root, file),
    },
  )

  if (changes.length === 0) ui.say("Nothing to change.", "Review")
  else {
    ui.say(reviewText(changes), "Review")
    if (ui.prompter !== null) {
      if (!(await ui.prompter.confirm({ message: "Write?", initialValue: true }))) {
        ui.prompter.outro("Nothing written.")
        return 0
      }
    } else if (!flags.yes) {
      io.stdout("Nothing written. Rerun with --yes to write these changes, or run rulecast init in a terminal.\n")
      return 2
    }
    await write(root, changes)
  }

  const errors = await validate(root, home, registry, ui)

  const prompt = draftPrompt(catalog?.rev ?? `v${VERSION}`, detection.primaryDoc)
  const toCommit = changes.filter((change) => change.commit).map((change) => change.file)
  const closing = toCommit.length === 0 ? "Done." : `Commit ${toCommit.join(" and ")}.`
  if (ui.prompter !== null) {
    ui.say(prompt, "Draft rules for your own conventions. Paste this into your coding agent:")
    if (await ui.prompter.confirm({ message: "Copy to clipboard?", initialValue: true })) {
      ui.say((await io.copyToClipboard(prompt)) ? "Copied." : "No clipboard command found: copy it from above.")
    }
    ui.prompter.outro(closing)
  } else {
    ui.say(prompt, "Draft rules for your own conventions. Paste this into your coding agent:")
    io.stdout(`${closing}\n`)
  }
  return errors > 0 ? 2 : 0
}

/** rulecast init (spec §12): detect, choose, review, write, validate, hand over the drafting prompt. */
export async function initCommand(args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const flags = parseFlags(args)
  const root = projectRoot(io.cwd)
  const prompter = io.interactive && !flags.yes ? await io.prompter() : null
  const ui: Ui = {
    prompter,
    say: (message, title) => {
      if (prompter !== null) prompter.note(message, title)
      else io.stdout(`${title === undefined ? "" : `${title}\n`}${message}\n\n`)
    },
  }
  try {
    return await run(root, flags, registry, io, ui)
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error
    io.stderr("rulecast: init cancelled\n")
    return 130
  }
}
