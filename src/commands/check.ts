import path from "node:path"
import { parseArgs } from "node:util"
import { glob } from "tinyglobby"

import { CLI_FORMATS, type CliFormat, exitCodeFor, formatDelivery } from "../adapters/cli/format"
import { changedFilesSince, mergeBase } from "../core/baseline/git"
import type { DetectorRegistry } from "../core/detection/registry"
import { runPipeline } from "../core/pipeline"
import type { CliIo } from "./main"

export class UsageError extends Error {}

function toProjectPath(root: string, cwd: string, file: string): string {
  return path.relative(root, path.resolve(cwd, file)).split(path.sep).join("/")
}

export async function checkCommand(
  root: string,
  args: string[],
  registry: DetectorRegistry,
  io: CliIo,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      base: { type: "string" },
      format: { type: "string", default: "terminal" },
      session: { type: "string" },
      "no-llm": { type: "boolean", default: false },
    },
  })
  const format = values.format as CliFormat
  if (!CLI_FORMATS.includes(format))
    throw new UsageError(`unknown format "${values.format}" (use ${CLI_FORMATS.join(", ")})`)

  let files: string[]
  if (positionals.length > 0) {
    files = positionals.map((file) => toProjectPath(root, io.cwd, file))
  } else if (values.base) {
    files = await changedFilesSince(root, await mergeBase(root, values.base))
  } else {
    files = (
      await glob(["**/*"], {
        cwd: root,
        dot: true,
        ignore: ["**/node_modules/**", "**/.git/**", ".rulecast/.state/**"],
      })
    ).sort()
  }

  const result = await runPipeline({
    root,
    event: {
      kind: "verify",
      files,
      baseRef: values.base,
      session: values.session ? { id: values.session } : undefined,
      cwd: root,
    },
    registry,
    maxContextChars: null,
    skipDetectorKinds: values["no-llm"] ? new Set(["llm"]) : undefined,
  })
  const text = formatDelivery(result.delivery, format, { maxMatchesPerRule: result.project.config.maxMatchesPerRule })
  if (text) io.stdout(`${text}\n`)
  return exitCodeFor(result.delivery, result.failed)
}
