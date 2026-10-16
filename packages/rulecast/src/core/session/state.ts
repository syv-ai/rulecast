import type { TreeState } from "./tree"

/** The agent of a session event without a subagent id: the one that owns integration. */
export const MAIN_AGENT = "main"

/** The editor of an `edited` record written before records named their agent: it counts as every agent. */
export const ANY_AGENT = "*"

export type WorkRecord =
  /**
   * `via: "shell"`: changed during the agent's shell call, not by an edit tool. `agent`: who edited;
   * absent in stores written before it was recorded.
   */
  | { t: "edited"; file: string; via?: "shell"; agent?: string }
  | { t: "accessed"; agent: string; file: string }
  | { t: "stopBlock"; agent: string }
  | { t: "refused"; rule: string; file: string }
  | { t: "prompt"; agent: string }
  | { t: "disabled"; rule: string; reason: string }
  | { t: "noticed"; key: string }
  /** The working tree at session start, before and after a shell call, and at a stop (session/tree.ts). */
  | { t: "tree"; phase: "start" | "before" | "after" | "stop"; agent: string; toolUseId?: string; state: TreeState }
  /**
   * Changed outside any of the agent's tool calls, found by comparing tree states: reported, never
   * blocking. `agent`: whose comparison found it; absent in stores written before it was recorded.
   */
  | { t: "swept"; file: string; agent?: string }

export type ContextRecord =
  | { t: "reset" }
  | { t: "delivered"; path: string; anchor: string | null; hash: number }
  | { t: "touched"; rule: string }
  | { t: "preexisting"; rule: string; file: string }
  | { t: "warned"; key: string }

export interface WorkState {
  /** Unique, least recently edited first. */
  edited: string[]
  /** Who edited each file. */
  editors: Map<string, Set<string>>
  stopBlocks: Map<string, number>
  /** How often each rule has refused a write to each file: the refuse gate's counter. */
  refusals: Map<string, number>
  disabled: Map<string, string>
  /** Files each agent read or edited, unique, least recently accessed first (§9 reset). */
  accessed: Map<string, string[]>
  /** Keys of the user notices already given this session (session/oversight.ts): each is told once. */
  noticed: Set<string>
  /** How each edited file was last changed: through an edit tool, or during a shell call. */
  editedVia: Map<string, "tool" | "shell">
  /** Unique, least recently swept first; a file the agent edits leaves it. */
  swept: string[]
  /** The agents whose comparisons swept each file in `swept`. */
  sweptBy: Map<string, Set<string>>
  /** Each agent's last recorded tree state, of any phase. The store is append-only, so record order is time order. */
  latestTree: Map<string, TreeState>
  /** The last tree state any agent recorded. */
  sessionLatestTree: TreeState | null
  /** The state recorded before each shell call, by its tool use id. */
  beforeTrees: Map<string, TreeState>
  /** The tree at session start: what was already dirty then. */
  startTree: TreeState | null
}

export interface ContextState {
  delivered: { path: string; anchor: string | null; hash: number }[]
  touched: Set<string>
  preexisting: Set<string>
  warned: Set<string>
}

export function preexistingKey(rule: string, file: string): string {
  return `${rule} ${file}`
}

/** A refusal is counted per rule and file: one rule may legitimately refuse several files. */
export const refusalKey = preexistingKey

export function emptyWork(): WorkState {
  return {
    edited: [],
    editors: new Map(),
    stopBlocks: new Map(),
    refusals: new Map(),
    disabled: new Map(),
    accessed: new Map(),
    noticed: new Set(),
    editedVia: new Map(),
    swept: [],
    sweptBy: new Map(),
    latestTree: new Map(),
    sessionLatestTree: null,
    beforeTrees: new Map(),
    startTree: null,
  }
}

export function emptyContext(): ContextState {
  return { delivered: [], touched: new Set(), preexisting: new Set(), warned: new Set() }
}

export function foldWork(records: readonly WorkRecord[]): WorkState {
  const state = emptyWork()
  for (const record of records) {
    switch (record.t) {
      case "edited": {
        state.edited = [...state.edited.filter((file) => file !== record.file), record.file]
        state.editedVia.set(record.file, record.via ?? "tool")
        state.swept = state.swept.filter((file) => file !== record.file)
        state.sweptBy.delete(record.file)
        const agent = record.agent ?? ANY_AGENT
        state.editors.set(record.file, new Set([...(state.editors.get(record.file) ?? []), agent]))
        break
      }
      case "swept":
        state.swept = [...state.swept.filter((file) => file !== record.file), record.file]
        state.sweptBy.set(record.file, new Set([...(state.sweptBy.get(record.file) ?? []), record.agent ?? ANY_AGENT]))
        break
      case "tree":
        state.latestTree.set(record.agent, record.state)
        state.sessionLatestTree = record.state
        if (record.phase === "before" && record.toolUseId !== undefined) {
          state.beforeTrees.set(record.toolUseId, record.state)
        }
        // A resumed session records another start; what was dirty is what was dirty at the first.
        if (record.phase === "start" && state.startTree === null) state.startTree = record.state
        break
      case "accessed": {
        const files = state.accessed.get(record.agent) ?? []
        state.accessed.set(record.agent, [...files.filter((file) => file !== record.file), record.file])
        break
      }
      case "stopBlock":
        state.stopBlocks.set(record.agent, (state.stopBlocks.get(record.agent) ?? 0) + 1)
        break
      case "refused": {
        const key = refusalKey(record.rule, record.file)
        state.refusals.set(key, (state.refusals.get(key) ?? 0) + 1)
        break
      }
      case "prompt":
        state.stopBlocks.delete(record.agent)
        break
      case "disabled":
        if (!state.disabled.has(record.rule)) state.disabled.set(record.rule, record.reason)
        break
      case "noticed":
        state.noticed.add(record.key)
        break
    }
  }
  return state
}

/**
 * The state a new tree state is compared with: the one recorded before this shell call when the
 * call has an id, otherwise this agent's latest, otherwise the session's latest (a subagent's first
 * call). null: nothing to compare with, as in a session that began before rulecast watched shells.
 */
export function referenceState(work: WorkState, agent: string, toolUseId?: string): TreeState | null {
  const before = toolUseId === undefined ? undefined : work.beforeTrees.get(toolUseId)
  return before ?? work.latestTree.get(agent) ?? work.sessionLatestTree
}

/** The swept files an agent's stop reports: those its own comparisons found, and every one for the main agent. */
export function sweptFor(work: WorkState, agent: string): string[] {
  if (agent === MAIN_AGENT) return work.swept
  return work.swept.filter((file) => {
    const by = work.sweptBy.get(file)
    return by?.has(agent) === true || by?.has(ANY_AGENT) === true
  })
}

/** Whether `agent` has a tree state of its own to compare with: the main agent always counts as having one. */
export function hasOwnTree(work: WorkState, agent: string): boolean {
  return agent === MAIN_AGENT || work.latestTree.has(agent)
}

/**
 * The files an agent's stop verifies, least recently edited first: its own edits, and every edit for
 * the main agent, which owns integration. A file another agent also edited is in both lists.
 */
export function editedBy(work: WorkState, agent: string): string[] {
  if (agent === MAIN_AGENT) return work.edited
  return work.edited.filter((file) => {
    const editors = work.editors.get(file)
    return editors?.has(agent) === true || editors?.has(ANY_AGENT) === true
  })
}

/** Whether `file` had uncommitted changes when the session started. */
export function dirtyAtStart(work: WorkState, file: string): boolean {
  return work.startTree !== null && file in work.startTree.entries
}

export function foldContext(records: readonly ContextRecord[]): ContextState {
  let state = emptyContext()
  for (const record of records) {
    switch (record.t) {
      case "reset":
        state = emptyContext()
        break
      case "delivered":
        state.delivered.push({ path: record.path, anchor: record.anchor, hash: record.hash })
        break
      case "touched":
        state.touched.add(record.rule)
        break
      case "preexisting":
        state.preexisting.add(preexistingKey(record.rule, record.file))
        break
      case "warned":
        state.warned.add(record.key)
        break
    }
  }
  return state
}
