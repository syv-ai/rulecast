import { createHash } from "node:crypto"

import type { HeadMove } from "../baseline/foreign"
import type { ActiveMode } from "../config/mode"
import type { TreeState } from "./tree"

/** The agent of a session event without a subagent id: the one that owns integration. */
export const MAIN_AGENT = "main"

/** The editor of an `edited` record written before records named their agent: it counts as every agent. */
export const ANY_AGENT = "*"

export type WorkRecord =
  /**
   * `via: "shell"`: changed during the agent's shell call, not by an edit tool. `agent`: who edited;
   * absent in stores written before it was recorded. `shared`: another agent's shell call ran in this
   * working tree at the same time, so the change may be partly theirs.
   */
  | { t: "edited"; file: string; via?: "shell"; agent?: string; shared?: true }
  | { t: "accessed"; agent: string; file: string }
  /** `findings`: the keys of the findings that blocked (session/decide.ts `findingKey`), for repeat detection. */
  | { t: "stopBlock"; agent: string; findings?: string[] }
  /** Unattended mode: the stop that told the agent to record what is left as unresolved, once per prompt. */
  | { t: "stopReport"; agent: string }
  /** Unattended mode: the stop that told the agent some rules did not run, once per prompt (#29). */
  | { t: "incompleteReport"; agent: string }
  | { t: "refused"; rule: string; file: string }
  | { t: "prompt"; agent: string }
  | { t: "disabled"; rule: string; reason: string }
  | { t: "noticed"; key: string }
  /** `HEAD` moved between two tree states: a git operation, whose commits from elsewhere are not the agent's (baseline/foreign.ts). */
  | ({ t: "head" } & HeadMove)
  /**
   * The working tree at session start, before and after a shell call, and at a stop (session/tree.ts).
   * `key` names its entries. With `base`, `state` holds no entries: they are the entries the store
   * recorded under `base`, with `set` and `unset` applied (treeRecord). Without `key`: an older store.
   */
  | ({ t: "tree"; phase: TreePhase; agent: string; toolUseId?: string } & TreeEncoding)
  /**
   * Changed outside any of the agent's tool calls, found by comparing tree states: reported, never
   * blocking. `agent`: whose comparison found it; absent in stores written before it was recorded.
   */
  | { t: "swept"; file: string; agent?: string }
  /** The mode the hooks ran this session in, so `rulecast run --session` judges as they did. */
  | { t: "mode"; mode: ActiveMode["mode"]; source: ActiveMode["source"]; detail: string }

export type TreePhase = "start" | "before" | "after" | "stop"

type TreeHeader = Omit<TreeState, "entries">

type TreeEncoding =
  | { state: TreeState; key?: string; base?: undefined }
  | { state: TreeHeader; key: string; base: string; set?: TreeState["entries"]; unset?: string[] }

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
  /** How many stops each finding has blocked, by `blockedKey(agent, finding)`. Never reset: a prompt does not make a false positive true. */
  blockedFindings: Map<string, number>
  /** Agents told to record their unresolved findings since their last prompt. */
  stopReports: Set<string>
  /** Agents told since their last prompt that configured rules did not run. */
  incompleteReports: Set<string>
  /** How often each rule has refused a write to each file: the refuse gate's counter. */
  refusals: Map<string, number>
  disabled: Map<string, string>
  /** Files each agent read or edited, unique, least recently accessed first (§9 reset). */
  accessed: Map<string, string[]>
  /** Keys of the user notices already given this session (session/oversight.ts): each is told once. */
  noticed: Set<string>
  /** How each edited file was last changed: through an edit tool, or during a shell call. */
  editedVia: Map<string, "tool" | "shell">
  /** Files changed during a shell call that another agent's shell call overlapped: possibly partly theirs. */
  sharedEdits: Set<string>
  /** Git operations seen this session, oldest first. */
  headMoves: HeadMove[]
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
  /** Every tree state's entries the store holds, by key: what a later record may name as its base. */
  treeEntries: Map<string, TreeState["entries"]>
  /** Each agent's last recorded tree state's key, which its next state is encoded against. */
  latestTreeKey: Map<string, string>
  /** The tree at session start: what was already dirty then. */
  startTree: TreeState | null
  /**
   * Shell calls whose after has not been recorded, by tool use id (or record position without one).
   * `shared`: another agent's shell call ran during it. An agent's prompt or stop closes its calls:
   * an interrupted command never records its after.
   */
  openShells: Map<string, { agent: string; shared: boolean }>
  /** The mode last recorded; null in a session recorded before modes were. */
  mode: ActiveMode | null
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

/** A finding's stop-block count is kept per agent: a subagent's blocks are not the main agent's. */
export function blockedKey(agent: string, finding: string): string {
  return `${agent}\n${finding}`
}

/** A refusal is counted per rule and file: one rule may legitimately refuse several files. */
export const refusalKey = preexistingKey

export function emptyWork(): WorkState {
  return {
    edited: [],
    editors: new Map(),
    stopBlocks: new Map(),
    blockedFindings: new Map(),
    stopReports: new Set(),
    incompleteReports: new Set(),
    refusals: new Map(),
    disabled: new Map(),
    accessed: new Map(),
    noticed: new Set(),
    editedVia: new Map(),
    sharedEdits: new Set(),
    headMoves: [],
    swept: [],
    sweptBy: new Map(),
    latestTree: new Map(),
    sessionLatestTree: null,
    beforeTrees: new Map(),
    treeEntries: new Map(),
    latestTreeKey: new Map(),
    startTree: null,
    openShells: new Map(),
    mode: null,
  }
}

export function emptyContext(): ContextState {
  return { delivered: [], touched: new Set(), preexisting: new Set(), warned: new Set() }
}

/** Moves `item` to the end of an insertion-ordered set: least recently touched first. */
function touch<T>(set: Set<T>, item: T): void {
  set.delete(item)
  set.add(item)
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key)
  if (set) set.add(value)
  else map.set(key, new Set([value]))
}

export function foldWork(records: readonly WorkRecord[]): WorkState {
  const state = emptyWork()
  // Ordered sets while folding, arrays once done: moving a file to the end of an array on every
  // record made a long session's fold quadratic (plan 21).
  const edited = new Set<string>()
  const swept = new Set<string>()
  const accessed = new Map<string, Set<string>>()
  for (const [index, record] of records.entries()) {
    switch (record.t) {
      case "edited": {
        touch(edited, record.file)
        state.editedVia.set(record.file, record.via ?? "tool")
        if (record.shared === true) state.sharedEdits.add(record.file)
        swept.delete(record.file)
        state.sweptBy.delete(record.file)
        addTo(state.editors, record.file, record.agent ?? ANY_AGENT)
        break
      }
      case "swept":
        touch(swept, record.file)
        addTo(state.sweptBy, record.file, record.agent ?? ANY_AGENT)
        break
      case "tree": {
        const tree = resolveTree(state, record)
        // Its base is gone (a damaged line was skipped): what it recorded cannot be known, but the
        // shell call it opens or closes still happened.
        if (tree !== null) {
          if (record.key === undefined) state.latestTreeKey.delete(record.agent)
          else {
            state.treeEntries.set(record.key, tree.entries)
            state.latestTreeKey.set(record.agent, record.key)
          }
          state.latestTree.set(record.agent, tree)
          state.sessionLatestTree = tree
          if (record.phase === "before" && record.toolUseId !== undefined) state.beforeTrees.set(record.toolUseId, tree)
          // A resumed session records another start; what was dirty is what was dirty at the first.
          if (record.phase === "start" && state.startTree === null) state.startTree = tree
        }
        if (record.phase === "before") openShell(state, record.agent, record.toolUseId ?? `#${index}`)
        else if (record.phase === "after") closeShell(state, shellCallOf(state, record.agent, record.toolUseId))
        else if (record.phase === "stop") closeShells(state, record.agent)
        break
      }
      case "accessed": {
        const files = accessed.get(record.agent) ?? new Set<string>()
        accessed.set(record.agent, files)
        touch(files, record.file)
        break
      }
      case "stopBlock":
        state.stopBlocks.set(record.agent, (state.stopBlocks.get(record.agent) ?? 0) + 1)
        for (const finding of record.findings ?? []) {
          const key = blockedKey(record.agent, finding)
          state.blockedFindings.set(key, (state.blockedFindings.get(key) ?? 0) + 1)
        }
        break
      case "stopReport":
        state.stopReports.add(record.agent)
        break
      case "incompleteReport":
        state.incompleteReports.add(record.agent)
        break
      case "refused": {
        const key = refusalKey(record.rule, record.file)
        state.refusals.set(key, (state.refusals.get(key) ?? 0) + 1)
        break
      }
      case "prompt":
        state.stopBlocks.delete(record.agent)
        state.stopReports.delete(record.agent)
        state.incompleteReports.delete(record.agent)
        closeShells(state, record.agent)
        break
      case "disabled":
        if (!state.disabled.has(record.rule)) state.disabled.set(record.rule, record.reason)
        break
      case "noticed":
        state.noticed.add(record.key)
        break
      case "head":
        state.headMoves.push({ from: record.from, to: record.to, since: record.since })
        break
      case "mode":
        state.mode = { mode: record.mode, source: record.source, detail: record.detail }
        break
    }
  }
  state.edited = [...edited]
  state.swept = [...swept]
  for (const [agent, files] of accessed) state.accessed.set(agent, [...files])
  return state
}

/** A tree record's state, its entries taken from its base when it names one; null when that is gone. */
function resolveTree(state: WorkState, record: Extract<WorkRecord, { t: "tree" }>): TreeState | null {
  if (record.base === undefined) return record.state
  const base = state.treeEntries.get(record.base)
  if (base === undefined) return null
  let entries = base
  if (record.set !== undefined || record.unset !== undefined) {
    entries = { ...base, ...record.set }
    for (const file of record.unset ?? []) delete entries[file]
  }
  return { ...record.state, entries }
}

function treeKey(entries: TreeState["entries"]): string {
  const sorted = Object.keys(entries)
    .sort()
    .map((file) => [file, entries[file]])
  return createHash("sha1").update(JSON.stringify(sorted)).digest("base64url")
}

/**
 * The record for a tree state, encoded against what `work` (the store as last read) holds: a state
 * the store already has is named by its key, and any other is written as its change from the agent's
 * last state when that is smaller. A session that wrote every state in full grew by the dirty tree
 * twice per shell call (plan 21).
 */
export function treeRecord(
  work: WorkState,
  record: { phase: TreePhase; agent: string; toolUseId?: string },
  now: TreeState,
): WorkRecord {
  const key = treeKey(now.entries)
  const { entries, ...header } = now
  const head = { t: "tree" as const, ...record }
  if (work.treeEntries.has(key)) return { ...head, state: header, key, base: key }
  const lastKey = work.latestTreeKey.get(record.agent)
  const last = lastKey === undefined ? undefined : work.treeEntries.get(lastKey)
  if (lastKey !== undefined && last !== undefined) {
    const set: TreeState["entries"] = {}
    for (const [file, entry] of Object.entries(entries)) {
      if (JSON.stringify(last[file]) !== JSON.stringify(entry)) set[file] = entry
    }
    const unset = Object.keys(last).filter((file) => !Object.hasOwn(entries, file))
    if (Object.keys(set).length + unset.length < Object.keys(entries).length) {
      return {
        ...head,
        state: header,
        key,
        base: lastKey,
        ...(Object.keys(set).length > 0 ? { set } : {}),
        ...(unset.length > 0 ? { unset } : {}),
      }
    }
  }
  return { ...head, state: now, key }
}

/** A shell call starts: it and every other agent's open call now ran alongside each other. */
function openShell(state: WorkState, agent: string, id: string): void {
  let shared = false
  for (const call of state.openShells.values()) {
    if (call.agent === agent) continue
    call.shared = true
    shared = true
  }
  state.openShells.set(id, { agent, shared })
}

function closeShell(state: WorkState, id: string | undefined): void {
  if (id !== undefined) state.openShells.delete(id)
}

function closeShells(state: WorkState, agent: string): void {
  for (const [id, call] of state.openShells) if (call.agent === agent) state.openShells.delete(id)
}

/** The open call an after belongs to: by tool use id, else the agent's latest open call. */
function shellCallOf(state: WorkState, agent: string, toolUseId: string | undefined): string | undefined {
  if (toolUseId !== undefined) return state.openShells.has(toolUseId) ? toolUseId : undefined
  let latest: string | undefined
  for (const [id, call] of state.openShells) if (call.agent === agent) latest = id
  return latest
}

/**
 * Whether another agent's shell call ran during this agent's open one: then both compared the same
 * working tree across each other's writes, and either may hold the other's changes as its own.
 */
export function sharedShell(work: WorkState, agent: string, toolUseId?: string): boolean {
  const id = shellCallOf(work, agent, toolUseId)
  return id !== undefined && work.openShells.get(id)?.shared === true
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
