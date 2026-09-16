import type { Detector } from "../types"

// Detector<any>: each detector has its own config type; the registry erases it.
export type AnyDetector = Detector<any>

export interface DetectorRegistry {
  get(kind: string): AnyDetector | undefined
  kinds(): string[]
}

export function createRegistry(detectors: AnyDetector[]): DetectorRegistry {
  const byKind = new Map<string, AnyDetector>()
  for (const detector of detectors) {
    if (byKind.has(detector.kind)) throw new Error(`detector "${detector.kind}" registered twice`)
    byKind.set(detector.kind, detector)
  }
  return {
    get: (kind) => byKind.get(kind),
    kinds: () => [...byKind.keys()],
  }
}
