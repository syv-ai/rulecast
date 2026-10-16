import path from "node:path"
import { BASE, PAGES, readme } from "./sources"

const BLOB = "https://github.com/syv-ai/rulecast/blob/main/"

/** The site URL of a page route. */
export function routeUrl(route: string): string {
  return `${BASE}/${route}/`
}

/** A heading's anchor, as GitHub makes it. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-")
}

/** The page holding the README heading `anchor` names: the README is split over several pages. */
function readmeRoute(anchor: string): string | null {
  for (const page of PAGES) {
    if (!("readme" in page.source)) continue
    const sections = readme()
    for (const heading of page.source.readme) {
      const headings = [heading, ...[...(sections.get(heading) ?? "").matchAll(/^#{3,6} (.+)$/gm)].map((m) => m[1]!)]
      if (headings.some((candidate) => slug(candidate.trim()) === anchor)) return page.route
    }
  }
  return null
}

/** The route of the page a repository file is published as, if it is one. */
function publishedRoute(repoPath: string, anchor?: string): string | null {
  if (repoPath === "README.md") return (anchor && readmeRoute(anchor)) ?? ""
  const page = PAGES.find((candidate) => "file" in candidate.source && candidate.source.file === repoPath)
  return page ? page.route : null
}

/**
 * Rewrites the relative links of Markdown read from `sourcePath` (relative to the repository root).
 * A link to a file the site publishes becomes its page; any other relative link becomes the file on
 * GitHub, and a link to a README heading goes to the page that section is on. Absolute URLs and
 * same-page anchors are left alone.
 */
export function rewriteLinks(markdown: string, sourcePath: string): string {
  return markdown.replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, (_, target: string) => {
    const [file = "", anchor] = target.split("#")
    const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), file))
    const route = publishedRoute(repoPath, anchor)
    const hash = anchor ? `#${anchor}` : ""
    if (route === null) return `](${BLOB}${repoPath}${hash})`
    return `](${route === "" ? `${BASE}/` : routeUrl(route)}${hash})`
  })
}
