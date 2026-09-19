import type { AnyDetector } from "../core/detection/registry"
import { pathDetector } from "./path"
import { regexDetector } from "./regex"

export const builtinDetectors: readonly AnyDetector[] = [regexDetector, pathDetector]
