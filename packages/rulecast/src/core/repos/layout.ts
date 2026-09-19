import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
/** git@github.com:owner/repo.git */
const SCP_LIKE = /^[^@/\s]+@([^:/\s]+):(.+)$/

type ParsedUrl = { kind: "hosted"; host: string; segments: string[] } | { kind: "local"; name: string }

function segmentsOf(repoPath: string): string[] {
  return repoPath
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean)
}

function localName(file: string): string {
  return path.basename(file.replace(/[\\/]+$/, "")).replace(/\.git$/, "")
}

function parseUrl(url: string): ParsedUrl {
  if (SCHEME.test(url)) {
    const parsed = new URL(url)
    if (parsed.protocol === "file:") return { kind: "local", name: localName(fileURLToPath(parsed)) }
    return { kind: "hosted", host: parsed.hostname, segments: segmentsOf(decodeURIComponent(parsed.pathname)) }
  }
  const scp = url.match(SCP_LIKE)
  if (scp) return { kind: "hosted", host: scp[1]!, segments: segmentsOf(scp[2]!) }
  return { kind: "local", name: localName(url) }
}

function safeSegment(value: string): string {
  const segment = value.replace(/[^A-Za-z0-9._-]/g, "_")
  // "", "." and ".." would resolve to the parent directory or the directory itself.
  return /^\.*$/.test(segment) ? `_${segment}` : segment
}

/** "syv-ai/rulecast" for hosted URLs; the directory name without ".git" for local paths and file:// URLs. */
export function repoName(url: string): string {
  const parsed = parseUrl(url)
  return parsed.kind === "hosted" ? parsed.segments.join("/") || parsed.host : parsed.name
}

function repoSlug(url: string): string {
  const parsed = parseUrl(url)
  if (parsed.kind === "hosted") return safeSegment([parsed.host, ...parsed.segments].join("_"))
  // Two local repos can share a directory name; the hash keeps them apart.
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 8)
  return safeSegment(`local_${parsed.name}_${hash}`)
}

/** <home>/repos/<slug>/<rev> */
export function repoDir(home: string, url: string, rev: string): string {
  return path.join(home, "repos", repoSlug(url), safeSegment(rev))
}

/** "<repoName(url)>@<rev>": how references from the repo are labelled. */
export function repoLabel(url: string, rev: string): string {
  return `${repoName(url)}@${rev}`
}
