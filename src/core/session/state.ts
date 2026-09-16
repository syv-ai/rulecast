export type WorkRecord =
  | { t: "edited"; file: string }
  | { t: "stopBlock"; agent: string }
  | { t: "prompt"; agent: string }
  | { t: "disabled"; rule: string; reason: string }

export type ContextRecord =
  | { t: "reset" }
  | { t: "delivered"; path: string; anchor: string | null; hash: number }
  | { t: "touched"; rule: string }
  | { t: "preexisting"; rule: string; file: string }
  | { t: "warned"; key: string }

export interface WorkState {
  /** Unique, least recently edited first. */
  edited: string[]
  stopBlocks: Map<string, number>
  disabled: Map<string, string>
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

export function emptyWork(): WorkState {
  return { edited: [], stopBlocks: new Map(), disabled: new Map() }
}

export function emptyContext(): ContextState {
  return { delivered: [], touched: new Set(), preexisting: new Set(), warned: new Set() }
}

export function foldWork(records: readonly WorkRecord[]): WorkState {
  const state = emptyWork()
  for (const record of records) {
    switch (record.t) {
      case "edited":
        state.edited = [...state.edited.filter((file) => file !== record.file), record.file]
        break
      case "stopBlock":
        state.stopBlocks.set(record.agent, (state.stopBlocks.get(record.agent) ?? 0) + 1)
        break
      case "prompt":
        state.stopBlocks.delete(record.agent)
        break
      case "disabled":
        if (!state.disabled.has(record.rule)) state.disabled.set(record.rule, record.reason)
        break
    }
  }
  return state
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
