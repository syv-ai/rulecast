import { claudeCodeAdapter } from "../adapters/claude-code/adapter"
import { compile } from "../core/compile/project"
import type { DetectorRegistry } from "../core/detection/registry"
import { warmableKinds } from "../core/detection/warm"
import { errorMessage } from "../core/errors"
import { cacheHome, debugLogger, ensureProjectState } from "../core/home"
import { runPipeline } from "../core/pipeline"
import { cachedRepos } from "../core/repos/provider"
import type { Adapter, Event } from "../core/types"
import type { CliIo } from "./main"
import { findRoot, hasProject, toProjectPath } from "./project"

const ADAPTERS: Readonly<Record<string, Adapter>> = { "claude-code": claudeCodeAdapter }

/** Hooks fail open (§14): every path exits 0; problems go to stderr and the debug log. */
export async function hookCommand(args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const name = args[0] ?? ""
  const adapter = ADAPTERS[name]
  if (!adapter) {
    io.stderr(`rulecast: unknown hook adapter "${name}" (use ${Object.keys(ADAPTERS).join(", ")})\n`)
    return 0
  }
  let input: unknown
  try {
    input = JSON.parse(await io.readStdin())
  } catch (error) {
    io.stderr(`rulecast: could not read hook input: ${errorMessage(error)}\n`)
    return 0
  }
  const parsed = adapter.parse(input)
  if (!parsed || (!parsed.event && !parsed.warmup)) return 0
  const root = findRoot(parsed.cwd)
  if (!hasProject(root)) return 0
  const home = cacheHome(io.env)
  const stateDir = ensureProjectState(home, root)
  const log = debugLogger(stateDir)
  try {
    // Hooks never fetch: a pinned repo missing from the cache disables its rules with a warning (spec §4).
    const compileProject = () => compile({ root, registry, repos: cachedRepos(home) })
    if (parsed.warmup) {
      const kinds = warmableKinds(await compileProject(), registry)
      if (kinds.length > 0) io.startWarm(root, kinds)
    }
    if (parsed.event) {
      await handleEvent({
        root,
        stateDir,
        cwd: parsed.cwd,
        event: parsed.event,
        adapter,
        registry,
        io,
        log,
        compileProject,
      })
    }
  } catch (error) {
    log(`hook ${adapter.name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    io.stderr(`rulecast: ${errorMessage(error)}\n`)
  }
  return 0
}

interface EventContext {
  root: string
  stateDir: string
  cwd: string
  event: Event
  adapter: Adapter
  registry: DetectorRegistry
  io: CliIo
  log: (line: string) => void
  compileProject: () => ReturnType<typeof compile>
}

async function handleEvent(context: EventContext): Promise<void> {
  const { root, stateDir, cwd, event, adapter, registry, io, log } = context
  const files = event.files
    .map((file) => toProjectPath(root, cwd, file))
    .filter((file): file is string => file !== null)
  if ((event.kind === "touch" || event.kind === "edit") && files.length === 0) return
  const projectEvent: Event = { ...event, files, cwd: root }
  const project = await context.compileProject()
  const result = await runPipeline({
    project,
    stateDir,
    event: projectEvent,
    registry,
    maxContextChars: adapter.maxContextChars,
    stopGate: projectEvent.kind === "verify",
    log,
  })
  const output = adapter.format(result.delivery, projectEvent, { maxMatchesPerRule: project.config.maxMatchesPerRule })
  if (output.stdout !== "") io.stdout(output.stdout)
  const missed = result.deadlineMissed.filter((kind) => registry.get(kind)?.warm !== undefined)
  if (missed.length > 0) io.startWarm(root, missed)
}
