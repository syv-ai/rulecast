import { tmpdir } from "node:os"

import { git } from "../git"
import { parseVersion } from "../version"
import { NO_PROMPT, RepoFetchError } from "./fetch"

export interface Tag {
  name: string
  /** The commit, peeled for annotated tags. */
  sha: string
}

const TAG_REF = "refs/tags/"
const PEELED = "^{}"

/** Every tag of a remote repository, sorted by name. */
export async function remoteTags(url: string): Promise<Tag[]> {
  const result = await git(tmpdir(), ["ls-remote", "--tags", url], NO_PROMPT)
  if (!result.ok) throw new RepoFetchError(result.stderr.trim() || `git ls-remote ${url} failed`)
  const tags = new Map<string, { sha: string; peeled: boolean }>()
  for (const line of result.stdout.split("\n")) {
    const [sha, ref] = line.split("\t")
    if (!sha || !ref?.startsWith(TAG_REF)) continue
    const peeled = ref.endsWith(PEELED)
    const name = ref.slice(TAG_REF.length, peeled ? -PEELED.length : undefined)
    // An annotated tag's peeled line names its commit; the plain line names the tag object.
    if (peeled || !tags.has(name)) tags.set(name, { sha, peeled })
  }
  return [...tags]
    .map(([name, { sha }]) => ({ name, sha }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

function versionOf(name: string): [number, number, number] | null {
  return /^v?\d+\.\d+\.\d+$/.test(name) ? parseVersion(name.replace(/^v/, "")) : null
}

/** The tag with the highest X.Y.Z version (an optional leading "v"); null when no tag is a version. */
export function latestTag(tags: readonly Tag[]): Tag | null {
  let best: { tag: Tag; version: [number, number, number] } | null = null
  for (const tag of tags) {
    const version = versionOf(tag.name)
    if (!version) continue
    if (best === null || compareVersions(version, best.version) > 0) best = { tag, version }
  }
  return best?.tag ?? null
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}
