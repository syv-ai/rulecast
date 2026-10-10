import path from "node:path"
import { BASE, PAGES } from "./sources"

const BLOB = "https://github.com/syv-ai/rulecast/blob/main/"

/** The site URL of a page route. */
export function routeUrl(route: string): string {
  return `${BASE}/${route}/`
}

/** The route of the page a repository file is published as, if it is one. */
function publishedRoute(repoPath: string): string | null {
  if (repoPath === "README.md") return ""
  const page = PAGES.find((candidate) => "file" in candidate.source && candidate.source.file === repoPath)
  return page ? page.route : null
}

/**
 * Rewrites the relative links of Markdown read from `sourcePath` (relative to the repository root).
 * A link to a file the site publishes becomes its page; any other relative link becomes the file on
 * GitHub. Absolute URLs and same-page anchors are left alone.
 */
export function rewriteLinks(markdown: string, sourcePath: string): string {
  return markdown.replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, (_, target: string) => {
    const [file = "", anchor] = target.split("#")
    const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), file))
    const route = publishedRoute(repoPath)
    const hash = anchor ? `#${anchor}` : ""
    if (route === null) return `](${BLOB}${repoPath}${hash})`
    return `](${route === "" ? `${BASE}/` : routeUrl(route)}${hash})`
  })
}
