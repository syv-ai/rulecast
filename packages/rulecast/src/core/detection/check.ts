import type { CompiledProject } from "../compile/project"
import { errorMessage } from "../errors"
import type { CheckResult, DetectorSettings } from "../types"
import type { DetectorRegistry } from "./registry"
import { rulesOfKind } from "./select"

export interface CheckOptions {
  project: CompiledProject
  registry: DetectorRegistry
  /** Project settings, as a detector run would get them. */
  settings: DetectorSettings
  env: Readonly<Record<string, string | undefined>>
  timeoutMs: number
}

/** A check's answer, and which detector gave it. */
export type KindCheckResult = CheckResult & { kind: string }

/** Detector kinds used by the project's rules whose detector has environment checks. */
export function checkableKinds(project: CompiledProject, registry: DetectorRegistry): string[] {
  const kinds = new Set<string>()
  for (const rule of project.rules) {
    const kind = rule.detector?.kind
    if (kind !== undefined && registry.get(kind)?.check !== undefined) kinds.add(kind)
  }
  return [...kinds]
}

/**
 * Every used detector's own checks (spec §5). Kinds run in parallel; results come back grouped by
 * kind in checkableKinds order, so doctor's output is stable between runs.
 */
export async function checkDetectors(options: CheckOptions): Promise<KindCheckResult[]> {
  const { project, registry } = options
  const kinds = checkableKinds(project, registry)
  const signal = AbortSignal.timeout(options.timeoutMs)
  const perKind = await Promise.all(
    kinds.map(async (kind): Promise<KindCheckResult[]> => {
      const detector = registry.get(kind)!
      const rules = rulesOfKind(project.rules, kind)
      try {
        const results = await detector.check!({
          rules,
          settings: options.settings,
          env: options.env,
          cwd: project.root,
          signal,
        })
        return results.map((result) => ({ kind, ...result }))
      } catch (error) {
        // A check that throws is the detector's own failure, not the project's: report it as one
        // error for the kind rather than letting it take doctor down.
        return [
          {
            kind,
            what: kind,
            level: "error",
            detail: errorMessage(error),
            rules: rules.map((rule) => rule.id),
          },
        ]
      }
    }),
  )
  return perKind.flat()
}
