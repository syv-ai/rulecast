import path from "node:path"

import type { CompiledProject } from "../compile/compile"
import { errorMessage } from "../errors"
import { LockTimeoutError, withLock } from "../session/lock"
import { detectorCacheDir, diskCache } from "./cache"
import type { DetectorRegistry } from "./registry"

export interface WarmOptions {
  root: string
  /** The project's state directory (core/home.ts): detector caches and warm locks. */
  stateDir: string
  project: CompiledProject
  registry: DetectorRegistry
  /** null = every kind with warm-up work. */
  kinds: readonly string[] | null
  timeoutMs: number
}

export interface WarmResult {
  warmed: string[]
  /** Another warm-up of the kind holds its lock. */
  skipped: string[]
  errors: { kind: string; message: string }[]
}

/** Never wait for another warm-up; a lock is abandoned only after a warm-up could have finished. */
const WARM_LOCK = { waitMs: 0, staleMs: 10 * 60_000, retryMs: 20 }

/** Detector kinds used by the project's rules whose detector has warm-up work. */
export function warmableKinds(project: CompiledProject, registry: DetectorRegistry): string[] {
  const kinds = new Set<string>()
  for (const rule of project.rules) {
    const kind = rule.detector?.kind
    if (kind !== undefined && registry.get(kind)?.warm !== undefined) kinds.add(kind)
  }
  return [...kinds]
}

export async function warmDetectors(options: WarmOptions): Promise<WarmResult> {
  const { root, stateDir, project, registry } = options
  const result: WarmResult = { warmed: [], skipped: [], errors: [] }
  const kinds = warmableKinds(project, registry).filter((kind) => options.kinds?.includes(kind) ?? true)
  const signal = AbortSignal.timeout(options.timeoutMs)
  await Promise.all(
    kinds.map(async (kind) => {
      const detector = registry.get(kind)!
      const rules = project.rules
        .filter((rule) => rule.detector?.kind === kind)
        .map((rule) => ({ id: rule.id, config: rule.detector!.config }))
      try {
        await withLock(
          path.join(stateDir, "warm", kind),
          () => detector.warm!({ rules, cache: diskCache(detectorCacheDir(stateDir, kind)), cwd: root, signal }),
          WARM_LOCK,
        )
        result.warmed.push(kind)
      } catch (error) {
        if (error instanceof LockTimeoutError) result.skipped.push(kind)
        else result.errors.push({ kind, message: errorMessage(error) })
      }
    }),
  )
  return result
}
