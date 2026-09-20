import type { AnyDetector } from "../core/detection/registry"
import { astGrepDetector } from "./ast-grep/detector"
import { commandDetector } from "./command/detector"
import { linterDetector } from "./linter/detector"
import { llmDetector } from "./llm/detector"
import { pathDetector } from "./path"
import { regexDetector } from "./regex"

export const builtinDetectors: readonly AnyDetector[] = [
  regexDetector,
  pathDetector,
  astGrepDetector,
  commandDetector,
  linterDetector,
  llmDetector,
]
