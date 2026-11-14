/**
 * A stand-in for an artifact's `db` capability (`await claude.use("db")`), shared by several
 * viewers, as runtime contract 0.2.96 describes it:
 * - `doc(id)` throws a TypeError for an id the path grammar refuses;
 * - `set` replaces a document, `update` merges into one and rejects `invalid_argument` when it is
 *   missing, `delete` removes one; a viewer who may not write is refused with `invalid_argument`;
 * - a viewer's own write shows in its snapshots at once with `hasPendingWrites: true`, and is
 *   rolled back from them when the store refuses it;
 * - a returning viewer can first get a stale copy (`fromCache: true`), then the store's;
 * - snapshots are frozen, arrive asynchronously and carry `docChanges()`;
 * - a verb can reject `unavailable` (`failNext`), and a listener ends after at most one error.
 * For the pages in agents/ that keep shared state.
 */

type Body = Record<string, unknown>
type Metadata = { fromCache: boolean; hasPendingWrites: boolean }
type DocumentSnapshot = { id: string; exists: boolean; data(): Body | undefined; metadata: Metadata }
type Snapshot = {
  docs: DocumentSnapshot[]
  size: number
  empty: boolean
  metadata: Metadata
  docChanges(): { type: "added" | "modified" | "removed"; doc: DocumentSnapshot; oldIndex: number; newIndex: number }[]
}
type DbError = { code: string; message: string }
type Listener = {
  collection: string
  viewer: number
  next: (snap: Snapshot) => void
  error?: (e: DbError) => void
  last: Map<string, Body>
}
/** A viewer's write the store has not answered yet, shown in that viewer's snapshots. */
type Pending = { collection: string; id: string; apply: (docs: Map<string, Body>) => void }

const SEGMENT = /^[A-Za-z0-9_\-.~:@+]{1,200}$/

/** Throws as the runtime's ref builders do, for a segment the path grammar refuses. */
function checkSegment(segment: string): void {
  if (!SEGMENT.test(segment) || segment === "." || segment === "..") {
    throw new TypeError(`invalid path segment ${JSON.stringify(segment)}`)
  }
}

export type FakeStore = ReturnType<typeof createFakeStore>

export function createFakeStore() {
  const collections = new Map<string, Map<string, Body>>()
  const listeners = new Set<Listener>()
  const pending = new Map<number, Pending[]>()
  let viewers = 0
  /** Writes held back until `release()`, to test what happens while a write is in flight. */
  let holding = false
  const held: (() => void)[] = []
  /** Error codes the next verbs reject with, in order. */
  const failures: string[] = []

  const docsOf = (name: string) => {
    let docs = collections.get(name)
    if (!docs) {
      docs = new Map()
      collections.set(name, docs)
    }
    return docs
  }

  /** What one viewer sees: the store, with its own unanswered writes on top. */
  const viewOf = (name: string, viewer: number) => {
    const docs = new Map([...docsOf(name)].map(([id, body]) => [id, { ...body }]))
    const mine = (pending.get(viewer) ?? []).filter((write) => write.collection === name)
    for (const write of mine) write.apply(docs)
    return { docs, hasPendingWrites: mine.length > 0 }
  }

  const deliver = (listener: Listener, docs: Map<string, Body>, metadata: Metadata) => {
    const ids = [...docs.keys()].sort()
    const frozen = new Map(ids.map((id) => [id, Object.freeze({ ...docs.get(id)! })]))
    const snapshotOf = (id: string, body: Body | undefined): DocumentSnapshot => ({
      id,
      exists: body !== undefined,
      data: () => body,
      metadata,
    })
    const docSnapshots = ids.map((id) => snapshotOf(id, frozen.get(id)))
    const before = [...listener.last.keys()].sort()
    const changes = [
      ...before
        .filter((id) => !frozen.has(id))
        .map((id) => ({
          type: "removed" as const,
          doc: snapshotOf(id, listener.last.get(id)),
          oldIndex: before.indexOf(id),
          newIndex: -1,
        })),
      ...ids
        .filter((id) => JSON.stringify(listener.last.get(id)) !== JSON.stringify(frozen.get(id)))
        .map((id) => ({
          type: listener.last.has(id) ? ("modified" as const) : ("added" as const),
          doc: snapshotOf(id, frozen.get(id)),
          oldIndex: before.indexOf(id),
          newIndex: ids.indexOf(id),
        })),
    ]
    listener.last = frozen
    listener.next({
      docs: docSnapshots,
      size: docSnapshots.length,
      empty: docSnapshots.length === 0,
      metadata,
      docChanges: () => changes,
    })
  }

  const notify = (name: string) => {
    for (const listener of listeners) {
      if (listener.collection !== name) continue
      const { docs, hasPendingWrites } = viewOf(name, listener.viewer)
      deliver(listener, docs, { fromCache: false, hasPendingWrites })
    }
  }

  /**
   * A write: shown to its viewer at once, then answered by the store (now, or on `release()`),
   * and confirmed to everyone or rolled back from its viewer.
   */
  const write = (viewer: number, name: string, id: string, check: () => void, apply: Pending["apply"]) =>
    new Promise<void>((resolve, reject) => {
      const failure = failures.shift()
      if (failure) {
        queueMicrotask(() => reject({ code: failure, message: `${failure} (test)` }))
        return
      }
      const entry = { collection: name, id, apply }
      pending.set(viewer, [...(pending.get(viewer) ?? []), entry])
      queueMicrotask(() => notify(name))
      const answer = () => {
        pending.set(
          viewer,
          (pending.get(viewer) ?? []).filter((one) => one !== entry),
        )
        try {
          check()
          apply(docsOf(name))
          resolve()
        } catch (error) {
          reject(error)
        }
        notify(name)
      }
      if (holding) held.push(answer)
      else queueMicrotask(answer)
    })

  const refused = (message: string): DbError => ({ code: "invalid_argument", message })

  return {
    /**
     * The db namespace one viewer gets. `canWrite: false` is a Viewer or Commenter. `cached` is a
     * copy saved on an earlier visit, delivered first with `fromCache: true`.
     */
    viewer({ canWrite = true, cached }: { canWrite?: boolean; cached?: Record<string, Body> } = {}) {
      const viewer = ++viewers
      const mayWrite = () => {
        if (!canWrite) throw refused("below the write level")
      }
      return {
        collection(name: string) {
          checkSegment(name)
          return {
            path: name,
            doc(id: string) {
              checkSegment(id)
              return {
                id,
                path: `${name}/${id}`,
                set: (body: Body) =>
                  write(viewer, name, id, mayWrite, (docs) => {
                    docs.set(id, { ...body })
                  }),
                update: (body: Body) =>
                  write(
                    viewer,
                    name,
                    id,
                    () => {
                      mayWrite()
                      if (!docsOf(name).has(id)) throw refused("update needs an existing document")
                    },
                    (docs) => {
                      const current = docs.get(id)
                      if (current) docs.set(id, { ...current, ...body })
                    },
                  ),
                delete: () =>
                  write(viewer, name, id, mayWrite, (docs) => {
                    docs.delete(id)
                  }),
              }
            },
            onSnapshot(next: Listener["next"], error?: Listener["error"]) {
              const listener: Listener = { collection: name, viewer, next, error, last: new Map() }
              listeners.add(listener)
              queueMicrotask(() => {
                if (!listeners.has(listener)) return
                if (cached)
                  deliver(listener, new Map(Object.entries(cached)), { fromCache: true, hasPendingWrites: false })
                const { docs, hasPendingWrites } = viewOf(name, viewer)
                deliver(listener, docs, { fromCache: false, hasPendingWrites })
              })
              return () => listeners.delete(listener)
            },
          }
        },
      }
    },
    /** A document as the store holds it. */
    get: (name: string, id: string) => docsOf(name).get(id),
    /** Another client's write, straight into the store. */
    put(name: string, id: string, body: Body) {
      docsOf(name).set(id, { ...body })
      notify(name)
    },
    /** Another client's delete, straight from the store. */
    remove(name: string, id: string) {
      docsOf(name).delete(id)
      notify(name)
    },
    hold() {
      holding = true
    },
    /** Lets the held writes through, in order. */
    release() {
      holding = false
      for (const answer of held.splice(0)) queueMicrotask(answer)
    },
    /** The next verbs reject with these codes, one each: `unavailable` is transient. */
    failNext(...codes: string[]) {
      failures.push(...codes)
    },
    /** Ends every listener with a terminal error, as when the page's host stops answering. */
    fail(code = "unavailable") {
      for (const listener of [...listeners]) {
        listeners.delete(listener)
        listener.error?.({ code, message: "the store stopped answering" })
      }
    },
  }
}

/** Lets queued microtasks, the writes they start and short timers run to the end. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 10; round++) await new Promise((resolve) => setTimeout(resolve, 0))
}
