import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

import { type RevUpdate, setRevs } from "../core/config/edit"
import { CONFIG_FILE } from "../core/config/load"
import { errorMessage } from "../core/errors"
import { latestTag, remoteTags, type Tag } from "../core/repos/tags"
import { loadProjectConfig } from "./install"
import type { CliIo } from "./main"
import { hasProject } from "./project"
import { UsageError } from "./usage"

/** Moves each URL repo's rev to its latest version tag, like pre-commit autoupdate. */
export async function autoupdateCommand(root: string, args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { freeze: { type: "boolean", default: false }, repo: { type: "string", multiple: true } },
  })
  if (!hasProject(root)) throw new Error(`no ${CONFIG_FILE} in ${io.cwd} or its parents`)
  const config = await loadProjectConfig(root, "autoupdate")
  const only = values.repo
  for (const url of only ?? []) {
    if (!config.repos.some((entry) => entry.repo === url)) throw new UsageError(`no repo "${url}" in ${CONFIG_FILE}`)
  }

  const updates: RevUpdate[] = []
  let failed = false
  for (const [index, entry] of config.repos.entries()) {
    if (entry.repo === "local" || entry.rev === undefined) continue
    if (only && !only.includes(entry.repo)) continue
    let latest: Tag | null
    try {
      latest = latestTag(await remoteTags(entry.repo))
    } catch (error) {
      io.stderr(`rulecast: ${entry.repo}: ${errorMessage(error)}\n`)
      failed = true
      continue
    }
    if (latest === null) {
      io.stdout(`${entry.repo}: no version tags\n`)
      continue
    }
    const rev = values.freeze ? latest.sha : latest.name
    if (rev === entry.rev) {
      io.stdout(`${entry.repo}: already up to date\n`)
      continue
    }
    io.stdout(`${entry.repo}: updating ${entry.rev} -> ${rev}${values.freeze ? ` (frozen: ${latest.name})` : ""}\n`)
    updates.push({ index, rev, frozenTag: values.freeze ? latest.name : null })
  }

  if (updates.length > 0) {
    const file = path.join(root, CONFIG_FILE)
    await writeFile(file, setRevs(await readFile(file, "utf8"), updates))
  }
  return failed ? 2 : 0
}
