import path from "node:path"

import { ADAPTERS, adapterByName } from "../adapters"
import { compile } from "../core/compile/project"
import { combineDeliveries } from "../core/delivery/combine"
import type { DetectorRegistry } from "../core/detection/registry"
import { warmableKinds } from "../core/detection/warm"
import { errorMessage } from "../core/errors"
import { cacheHome, debugLogger, ensureProjectState } from "../core/home"
import { runPipeline } from "../core/pipeline"
import {
  configRootsAbove,
  projectsForEvent,
  projectsForFiles,
  recordSessionRoots,
  sessionRoots,
} from "../core/projects"
import { cachedRepos } from "../core/repos/provider"
import type { Adapter, AdapterInput, Delivery, Event } from "../core/types"
import type { CliIo } from "./main"

/** Hooks fail open (§14): every path exits 0; problems go to stderr and the debug log. */
export async function hookCommand(args: string[], registry: DetectorRegistry, io: CliIo): Promise<number> {
  const name = args[0] ?? ""
  const adapter = adapterByName(name)
  if (!adapter) {
    io.stderr(`rulecast: unknown hook adapter "${name}" (use ${ADAPTERS.map((known) => known.name).join(", ")})\n`)
    return 0
  }
  let input: unknown
  try {
    input = JSON.parse(await io.readStdin())
  } catch (error) {
    io.stderr(`rulecast: could not read hook input: ${errorMessage(error)}\n`)
    return 0
  }
  // Everything from here can throw — an unwritable cache home, a root that vanished — and the hook
  // still exits 0. Each project's own failures go to its own debug log (runProject).
  try {
    const parsed = adapter.parse(input)
    if (!parsed || (!parsed.event && !parsed.warmup)) return 0
    // The adapter reads only the payload; where the session started comes from the hook's environment.
    const launchDir = io.env.CLAUDE_PROJECT_DIR || parsed.cwd
    const event: Event | null = parsed.event ? { ...parsed.event, launchDir } : null
    const home = cacheHome(io.env)
    const projects = await projectsFor(parsed, event, launchDir, home)
    if (projects.size === 0) return 0
    const routed = {
      parsed,
      event,
      adapter,
      registry,
      io,
      home,
      seat: budgetSeats(adapter.maxContextChars, projects.size),
    }
    const sessionId = event?.session?.id
    const [, ...runs] = await Promise.all([
      // A start recorded its roots while finding them (projectsForEvent).
      sessionId === undefined || event?.kind === "start"
        ? undefined
        : recordRoots(home, sessionId, [...projects.keys()]).catch((error: unknown) =>
            io.stderr(`rulecast: ${errorMessage(error)}\n`),
          ),
      ...[...projects].map(([root, files]) => runProject(root, files, routed)),
    ])
    const parts = runs.filter((run): run is ProjectRun => run !== null)
    if (event === null || parts.length === 0) return 0
    const delivery = combineDeliveries(parts, parsed.cwd)
    // The nearest project's setting: the first part is the config nearest the agent or the file.
    const output = adapter.format(delivery, event, { maxMatchesPerRule: parts[0]!.maxMatchesPerRule })
    if (output.stdout !== "") io.stdout(output.stdout)
  } catch (error) {
    io.stderr(`rulecast: ${errorMessage(error)}\n`)
  }
  return 0
}

/**
 * Every project the event belongs to, each with its root-relative files (core/projects.ts). An event
 * with files goes to every config above each file; one without (a stop, a prompt, a session start, a
 * shell call) to the projects the session has run and those above where the agent is and started.
 */
async function projectsFor(
  parsed: AdapterInput,
  event: Event | null,
  launchDir: string,
  home: string,
): Promise<Map<string, string[] | null>> {
  if (event !== null && event.files.length > 0) return projectsForFiles(parsed.cwd, event.files)
  const sessionId = event?.session?.id
  const roots =
    sessionId === undefined
      ? configRootsAbove(parsed.cwd)
      : await projectsForEvent({ cwd: parsed.cwd, launchDir, sessionId, kind: event?.kind ?? "start" }, home)
  return new Map(roots.map((root) => [root, null]))
}

/** Appends the roots the session has not run before; a repeat costs a read, not a write. */
async function recordRoots(home: string, sessionId: string, roots: string[]): Promise<void> {
  const known = new Set(await sessionRoots(home, sessionId))
  const fresh = roots.filter((root) => !known.has(path.resolve(root)))
  if (fresh.length > 0) await recordSessionRoots(home, sessionId, fresh)
}

interface Routed {
  parsed: AdapterInput
  event: Event | null
  adapter: Adapter
  registry: DetectorRegistry
  io: CliIo
  home: string
  /** Each project's seat at the adapter's context budget (budgetSeats). */
  seat: () => BudgetSeat
}

interface BudgetSeat {
  /** This project has (or has not) something for the agent; resolves to its share once every project has said. */
  claim: (delivers: boolean) => Promise<number | null>
  /** This project applies no budget: a path without output, or a failure. A no-op after `claim`. */
  leave: () => void
}

/**
 * One event's context budget, shared by its projects: divided only among those with something for
 * the agent (at least one), so a session with many configs does not shrink the one that found
 * something. Each project says so just before its budget is applied (PipelineOptions.shareBudget),
 * after its detectors ran: the claims wait for each other, not for a second run. Every seat must
 * claim or leave exactly once, or the claims never resolve.
 */
function budgetSeats(total: number | null, parties: number): () => BudgetSeat {
  let waiting = parties
  let delivering = 0
  let release: (share: number | null) => void = () => {}
  const shared = new Promise<number | null>((resolve) => {
    release = resolve
  })
  const settle = () => {
    waiting -= 1
    if (waiting === 0) release(total === null ? null : Math.floor(total / Math.max(1, delivering)))
  }
  return () => {
    let done = false
    return {
      claim: (delivers) => {
        if (!done) {
          done = true
          if (delivers) delivering += 1
          settle()
        }
        return shared
      },
      leave: () => {
        if (done) return
        done = true
        settle()
      },
    }
  }
}

interface ProjectRun {
  root: string
  delivery: Delivery
  maxMatchesPerRule: number
}

/**
 * One project's run of the event: its own state, compile, session and seat at the budget. Paths in
 * its delivery are shown from the agent's cwd. A failure is this project's alone: logged in its debug
 * log, and the other projects still deliver.
 */
async function runProject(root: string, files: string[] | null, routed: Routed): Promise<ProjectRun | null> {
  const { parsed, event, adapter, registry, io, home } = routed
  const seat = routed.seat()
  let log: ((line: string) => void) | undefined
  try {
    const stateDir = ensureProjectState(home, root)
    log = debugLogger(stateDir)
    // Hooks never fetch: a pinned repo missing from the cache disables its rules with a warning (spec §4).
    // The hook's environment is the agent's: RULECAST_MODE or CI there picks unattended mode.
    const project = await compile({ root, registry, repos: cachedRepos(home), env: io.env })
    // Nobody reads a hook's stderr: a typo here would quietly leave an unattended run attended.
    if (project.mode.ignored !== undefined) {
      log(
        `RULECAST_MODE=${project.mode.ignored} is ignored (use attended, interactive or unattended); mode is ${project.mode.mode}`,
      )
    }
    if (parsed.warmup) {
      const kinds = warmableKinds(project, registry)
      if (kinds.length > 0) io.startWarm(root, kinds)
    }
    if (event === null) return null
    const projectEvent: Event = { ...event, files: files ?? [], cwd: root }
    const result = await runPipeline({
      project,
      stateDir,
      event: projectEvent,
      registry,
      maxContextChars: adapter.maxContextChars,
      shareBudget: seat.claim,
      restoredFiles: adapter.restoredFiles,
      stopGate: projectEvent.kind === "verify",
      recordMode: true,
      displayFrom: parsed.cwd,
      log,
    })
    const missed = result.deadlineMissed.filter((kind) => registry.get(kind)?.warm !== undefined)
    if (missed.length > 0) io.startWarm(root, missed)
    return { root, delivery: result.delivery, maxMatchesPerRule: project.config.maxMatchesPerRule }
  } catch (error) {
    log?.(`hook ${adapter.name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    io.stderr(`rulecast: ${errorMessage(error)}\n`)
    return null
  } finally {
    seat.leave()
  }
}
