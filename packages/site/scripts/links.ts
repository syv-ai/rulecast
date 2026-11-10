import path from "node:path"
import { BASE, FRAGMENT_PAGE, FRAGMENTS, LEAD, PAGES, readme } from "./sources"

const BLOB = "https://github.com/syv-ai/rulecast/blob/main/"

/** The site URL of a page route. */
export function routeUrl(route: string): string {
  return `${BASE}/${route}/`
}

/** A heading's anchor, as GitHub makes it. */
export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-")
}

/**
 * The page holding the README heading `anchor` names: the README is split over several pages. A `##`
 * heading equal to the page's title is dropped from the page, so a link to it keeps no anchor. The
 * FRAGMENTS sections are on FRAGMENT_PAGE, under their own headings.
 */
function readmeRoute(anchor: string): { route: string; anchor?: string } | null {
  const sections = readme()
  const holds = (heading: string) =>
    (heading !== LEAD && slug(heading) === anchor) ||
    [...(sections.get(heading) ?? "").matchAll(/^#{3,6} (.+)$/gm)].some((m) => slug(m[1]!.trim()) === anchor)
  for (const page of PAGES) {
    if (!("readme" in page.source)) continue
    for (const heading of page.source.readme) {
      if (heading === page.title && slug(heading) === anchor) return { route: page.route }
      if (holds(heading)) return { route: page.route, anchor }
    }
  }
  if (Object.values(FRAGMENTS).some(holds)) return { route: FRAGMENT_PAGE, anchor }
  return null
}

/** The route of the page a repository file is published as, if it is one, and the anchor to keep. */
function publishedRoute(repoPath: string, anchor?: string): { route: string; anchor?: string } | null {
  if (repoPath === "README.md") return (anchor ? readmeRoute(anchor) : null) ?? { route: "", anchor }
  const page = PAGES.find((candidate) => "file" in candidate.source && candidate.source.file === repoPath)
  return page ? { route: page.route, anchor } : null
}

/**
 * Link text that only names the target file: `agents/reference/rule-format.md`, `output.md`, as
 * written in the link, from the repository root or by basename, with or without backticks.
 */
function namesFile(text: string, written: string, repoPath: string): boolean {
  const bare = text.replace(/^`(.*)`$/, "$1")
  return bare === written || bare === repoPath || bare === path.posix.basename(repoPath)
}

/**
 * Rewrites the relative links of Markdown read from `sourcePath` (relative to the repository root).
 * A link to a file the site publishes becomes its page; any other relative link becomes the file on
 * GitHub, and a link to a README heading goes to the page that section is on. Absolute URLs and
 * same-page anchors are left alone. On the site a file path means nothing to the reader, so a link
 * whose text is the path of the page it leads to reads as that page's title; the files keep the
 * path, for the agents that read them raw.
 */
export function rewriteLinks(markdown: string, sourcePath: string): string {
  return markdown.replace(
    /(!?)\[([^\]\n]*)\]\((?!https?:|#|mailto:)([^)\s]+)\)/g,
    (_, bang: string, text: string, target: string) => {
      const [file = "", anchor] = target.split("#")
      const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), file))
      const published = publishedRoute(repoPath, anchor)
      if (published === null) return `${bang}[${text}](${BLOB}${repoPath}${anchor ? `#${anchor}` : ""})`
      const hash = published.anchor ? `#${published.anchor}` : ""
      const title = PAGES.find((page) => page.route === published.route)?.title
      const label = !bang && title && namesFile(text, file, repoPath) ? title : text
      return `${bang}[${label}](${published.route === "" ? `${BASE}/` : routeUrl(published.route)}${hash})`
    },
  )
}

/**
 * A page made of README sections and a file reads as one page, so a sentence in one part that sends
 * the reader to another part of the same page ("More in [Writing rules]" on Writing rules, "the
 * README's [Commands]" on Commands) points at the page itself. Those sentences are left out of the
 * page; the repository's files keep them, where they are true. Only plain paragraphs are touched:
 * lists, tables, quotes, headings and code stay as they are, and so does a link within the part.
 */
export function dropSelfPointers(markdown: string, sourcePath: string, route: string): string {
  const pointsHere = (sentence: string) =>
    [...sentence.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)].some((match) => {
      const [file = "", anchor] = match[1]!.split("#")
      const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), file))
      return repoPath !== sourcePath && publishedRoute(repoPath, anchor)?.route === route
    })
  const blocks = markdown.split(/(\n{2,})/)
  let fenced = false
  const kept: string[] = []
  for (let index = 0; index < blocks.length; index += 2) {
    const block = blocks[index]!
    const separator = blocks[index + 1] ?? ""
    const plain = !fenced && !/^(\s*([-*+]|\d+\.)\s|[|>#<:]|```)/.test(block)
    if ((block.match(/^```/gm) ?? []).length % 2 === 1) fenced = !fenced
    if (!plain) {
      kept.push(block, separator)
      continue
    }
    const sentences = block.split(/(?<=[.!?])\s+(?=\S)/)
    const left = sentences.filter((sentence) => !pointsHere(sentence))
    if (left.length === sentences.length) kept.push(block, separator)
    else if (left.length > 0) kept.push(left.join(" "), separator)
  }
  return kept.join("").replace(/\n{2,}$/, markdown.match(/\n*$/)![0])
}
