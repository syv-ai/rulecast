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
  /** An agent's edit tool is about to write `file` (PreToolUse): a shell call running alongside did not write it. */
  | { t: "claimed"; agent: string; file: string }
  | { t: "accessed"; agent: string; file: string }
  | { t: "stopBlock"; agent: string }
  | { t: "refused"; rule: string; file: string }
  | { t: "prompt"; agent: string }
  | { t: "disabled"; rule: string; reason: string }
  | { t: "noticed"; key: string }
  /** The working tree at session start, before and after a shell call, and at a stop (session/tree.ts). */
  | { t: "tree"; phase: "start" | "before" | "after" | "stop"; agent: string; toolUseId?: string; state: TreeState }
  /** Changed outside any of the agent's tool calls, found by comparing tree states: reported, never blocking. */
  | { t: "swept"; file: string }

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
  /** The last write each file was claimed for by an agent's edit tool: by whom, and the record's position in the store. */
  lastClaim: Map<string, { agent: string; seq: number }>
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
  /** Each agent's last recorded tree state, of any phase. The store is append-only, so record order is time order. */
  latestTree: Map<string, TreeState>
  /** The last tree state any agent recorded. */
  sessionLatestTree: TreeState | null
  /** The state recorded before each shell call, by its tool use id. */
  beforeTrees: Map<string, TreeState>
  /** The store positions of latestTree, sessionLatestTree and beforeTrees, in the same keys. */
  latestTreeSeq: Map<string, number>
  sessionLatestTreeSeq: number | null
  beforeTreeSeq: Map<string, number>
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
    lastClaim: new Map(),
    stopBlocks: new Map(),
    refusals: new Map(),
    disabled: new Map(),
    accessed: new Map(),
    noticed: new Set(),
    editedVia: new Map(),
    swept: [],
    latestTree: new Map(),
    sessionLatestTree: null,
    beforeTrees: new Map(),
    latestTreeSeq: new Map(),
    sessionLatestTreeSeq: null,
    beforeTreeSeq: new Map(),
    startTree: null,
  }
}

export function emptyContext(): ContextState {
  return { delivered: [], touched: new Set(), preexisting: new Set(), warned: new Set() }
}

export function foldWork(records: readonly WorkRecord[]): WorkState {
  const state = emptyWork()
  // The store is append-only, so a record's position is its place in time.
  for (const [seq, record] of records.entries()) {
    switch (record.t) {
      case "edited": {
        state.edited = [...state.edited.filter((file) => file !== record.file), record.file]
        state.editedVia.set(record.file, record.via ?? "tool")
        state.swept = state.swept.filter((file) => file !== record.file)
        const agent = record.agent ?? ANY_AGENT
        state.editors.set(record.file, new Set([...(state.editors.get(record.file) ?? []), agent]))
        // A shell call's changes are not a claim: they are what a claim is compared against.
        if (record.via === undefined) state.lastClaim.set(record.file, { agent, seq })
        break
      }
      case "claimed":
        state.lastClaim.set(record.file, { agent: record.agent, seq })
        break
      case "swept":
        state.swept = [...state.swept.filter((file) => file !== record.file), record.file]
        break
      case "tree":
        state.latestTree.set(record.agent, record.state)
        state.latestTreeSeq.set(record.agent, seq)
        state.sessionLatestTree = record.state
        state.sessionLatestTreeSeq = seq
        if (record.phase === "before" && record.toolUseId !== undefined) {
          state.beforeTrees.set(record.toolUseId, record.state)
          state.beforeTreeSeq.set(record.toolUseId, seq)
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

/** The store position of the state referenceState returns, by the same fallbacks; null when there is none. */
export function referenceSeq(work: WorkState, agent: string, toolUseId?: string): number | null {
  const before = toolUseId === undefined ? undefined : work.beforeTreeSeq.get(toolUseId)
  return before ?? work.latestTreeSeq.get(agent) ?? work.sessionLatestTreeSeq
}

/**
 * Whether another agent's edit tool claimed `file` after the state at store position `since`: a
 * change to it measured from that state is that agent's write, not this one's. A claim is recorded
 * before the tool writes (PreToolUse), so it never arrives after the write it announces.
 */
export function claimedByOther(work: WorkState, agent: string, file: string, since: number | null): boolean {
  const claim = work.lastClaim.get(file)
  return claim !== undefined && claim.agent !== agent && claim.agent !== ANY_AGENT && claim.seq > (since ?? -1)
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
