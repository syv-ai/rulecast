import path from "node:path"

import { repositoryTop } from "../git"
import { configRootsAbove } from "../projects"
import { CONFIG_FILE, parseConfig, readConfigData } from "./load"

/** Where new conventions go, both paths relative to the repository top. */
export interface ConventionsTarget {
  /** The file or folder, as the config wrote it, rebased onto the repository top. */
  path: string
  /** The config that names it. */
  from: string
}

const slashed = (file: string) => file.split(path.sep).join("/")

/**
 * The one owner of where new conventions are written (plan 20): the `conventions` of the nearest
 * config at or above `root` that names one. It is the only key a config inherits from above; every
 * other key applies to its own config alone. A config that does not load is passed over: validate
 * reports it, and the question here is only where a convention should go.
 */
export async function conventionsFor(root: string): Promise<ConventionsTarget | null> {
  const top = await repositoryTop(root)
  for (const dir of configRootsAbove(root)) {
    const data = await readConfigData(dir)
    if (!data.ok) continue
    const config = parseConfig(data.value ?? {})
    if (!config.ok || config.value.conventions === null) continue
    const target = path.relative(top, path.resolve(dir, config.value.conventions))
    // A folder keeps its trailing slash, so it still reads as one.
    const folder = /[/\\]$/.test(config.value.conventions) ? "/" : ""
    return { path: `${slashed(target)}${folder}`, from: slashed(path.relative(top, path.join(dir, CONFIG_FILE))) }
  }
  return null
}
