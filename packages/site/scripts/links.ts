import path from "node:path"
import { fromMarkdown } from "mdast-util-from-markdown"
import { BASE, BLOB, FRAGMENT_PAGE, FRAGMENTS, LEAD, PAGES, readme } from "./sources"

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

/** As much of an mdast node as the link finder reads. */
interface MdNode {
  type: string
  children?: MdNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

/** A relative inline link or image in Markdown, by its offsets in the text. */
export interface RelativeLink {
  image: boolean
  /** The whole `[text](target)`. */
  start: number
  end: number
  /** The text between the brackets: an image's alt, or a link's content as written. */
  textStart: number
  textEnd: number
  /** Whether the link's content is only text and code, which a title may replace. */
  plain: boolean
  /** The destination as written, and where it is. */
  target: string
  targetStart: number
  targetEnd: number
}

const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|#|\/)/i

/**
 * The relative inline links and images of a Markdown text, read from its syntax tree: link text may
 * span lines and hold brackets, code or an image, and a link in code is no link. Absolute URLs,
 * same-page anchors and reference-style links are left out.
 */
export function relativeLinks(markdown: string): RelativeLink[] {
  const found: RelativeLink[] = []
  const visit = (node: MdNode) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if ((node.type === "link" || node.type === "image") && start !== undefined && end !== undefined) {
      const link = inlineLink(markdown, node, start, end)
      if (link && !ABSOLUTE.test(link.target)) found.push(link)
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(fromMarkdown(markdown) as MdNode)
  return found.sort((a, b) => a.start - b.start)
}

function inlineLink(markdown: string, node: MdNode, start: number, end: number): RelativeLink | null {
  const image = node.type === "image"
  // An autolink (`<https://…>`) is a link with no `](`; it is always absolute.
  if (markdown[end - 1] !== ")") return null
  const last = node.children?.at(-1)?.position?.end.offset
  const textStart = start + (image ? 2 : 1)
  const close =
    !image && last !== undefined && markdown.startsWith("](", last) ? last : markdown.indexOf("](", textStart)
  if (close === -1 || close >= end) return null
  const destination = /^\s*(<([^>]*)>|(\S+))/.exec(markdown.slice(close + 2, end - 1))
  if (!destination) return null
  const target = destination[2] ?? destination[3]!
  const targetStart = close + 2 + destination[0].length - target.length - (destination[2] === undefined ? 0 : 1)
  const plain = (node.children ?? []).every((child) => child.type === "text" || child.type === "inlineCode")
  return {
    image,
    start,
    end,
    textStart,
    textEnd: close,
    plain,
    target,
    targetStart,
    targetEnd: targetStart + target.length,
  }
}

interface Edit {
  start: number
  end: number
  text: string
}

/** Applies edits that do not overlap, from the last to the first, so each offset still holds. */
function applyEdits(markdown: string, edits: Edit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), markdown)
}

/** A link target's repository path, resolved against the file it is written in, and its anchor. */
function resolve(target: string, sourcePath: string): { file: string; repoPath: string; anchor?: string } {
  const [file = "", anchor] = target.split("#")
  return { file, repoPath: path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), file)), anchor }
}

const onGitHub = (repoPath: string, anchor?: string) => `${BLOB}${repoPath}${anchor ? `#${anchor}` : ""}`

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
 * GitHub, at the ref the site's content is from, and a link to a README heading goes to the page
 * that section is on. Absolute URLs and same-page anchors are left alone. On the site a file path
 * means nothing to the reader, so a link whose text is the path of the page it leads to reads as
 * that page's title; the files keep the path, for the agents that read them raw.
 */
export function rewriteLinks(markdown: string, sourcePath: string): string {
  const edits: Edit[] = []
  for (const link of relativeLinks(markdown)) {
    const { file, repoPath, anchor } = resolve(link.target, sourcePath)
    const published = publishedRoute(repoPath, anchor)
    if (published === null) {
      edits.push({ start: link.targetStart, end: link.targetEnd, text: onGitHub(repoPath, anchor) })
      continue
    }
    const hash = published.anchor ? `#${published.anchor}` : ""
    const url = `${published.route === "" ? `${BASE}/` : routeUrl(published.route)}${hash}`
    edits.push({ start: link.targetStart, end: link.targetEnd, text: url })
    const title = PAGES.find((page) => page.route === published.route)?.title
    const text = markdown.slice(link.textStart, link.textEnd)
    if (!link.image && link.plain && title && namesFile(text, file, repoPath)) {
      edits.push({ start: link.textStart, end: link.textEnd, text: title })
    }
  }
  return applyEdits(markdown, edits)
}

/**
 * An agent doc as the site serves it raw, under its repository path. Its relative links resolve
 * against its own URL, so a link to another file the site serves raw (`served`) stays as written;
 * a link to anything else, a guide or the README say, would be a dead link on the site, so it
 * becomes that file on GitHub, at the ref the site's content is from: the same version of the
 * same Markdown, and the anchors GitHub makes.
 */
export function rawAgentDoc(markdown: string, sourcePath: string, served: (repoPath: string) => boolean): string {
  const edits: Edit[] = []
  for (const link of relativeLinks(markdown)) {
    const { repoPath, anchor } = resolve(link.target, sourcePath)
    if (!served(repoPath))
      edits.push({ start: link.targetStart, end: link.targetEnd, text: onGitHub(repoPath, anchor) })
  }
  return applyEdits(markdown, edits)
}

/** Where a sentence may end in a paragraph: after `.`, `!` or `?` and a space, outside a link. */
function sentenceBreaks(paragraph: string, links: RelativeLink[], offset: number): number[] {
  const breaks: number[] = []
  for (const match of paragraph.matchAll(/(?<=[.!?])\s+(?=\S)/g)) {
    const at = offset + match.index
    if (!links.some((link) => link.start < at && at < link.end)) breaks.push(match.index, match.index + match[0].length)
  }
  return breaks
}

/**
 * A page made of README sections and a file reads as one page, so a sentence in one part that sends
 * the reader to another part of the same page ("More in [Writing rules]" on Writing rules, "the
 * README's [Commands]" on Commands) points at the page itself. Those sentences are left out of the
 * page; the repository's files keep them, where they are true. Only plain paragraphs are touched:
 * lists, tables, quotes, headings and code stay as they are, and so does a link within the part.
 */
export function dropSelfPointers(markdown: string, sourcePath: string, route: string): string {
  const links = relativeLinks(markdown)
  const pointsHere = (link: RelativeLink) => {
    const { repoPath, anchor } = resolve(link.target, sourcePath)
    return repoPath !== sourcePath && publishedRoute(repoPath, anchor)?.route === route
  }
  const blocks = (fromMarkdown(markdown) as MdNode).children ?? []
  const edits: Edit[] = []
  const dropped = new Set<number>()
  blocks.forEach((block, index) => {
    const start = block.position?.start.offset ?? 0
    const end = block.position?.end.offset ?? 0
    const text = markdown.slice(start, end)
    // Without GFM a table, and an aside's `:::` line, parse as paragraphs: they are not prose.
    if (block.type !== "paragraph" || /^[|:]/.test(text)) return
    const cuts = [0, ...sentenceBreaks(text, links, start), text.length]
    const sentences: { from: number; to: number }[] = []
    for (let i = 0; i < cuts.length; i += 2) sentences.push({ from: cuts[i]!, to: cuts[i + 1]! })
    const left = sentences.filter(
      ({ from, to }) =>
        !links.some((link) => link.start >= start + from && link.start < start + to && pointsHere(link)),
    )
    if (left.length === sentences.length) return
    if (left.length > 0) {
      edits.push({ start, end, text: left.map(({ from, to }) => text.slice(from, to)).join(" ") })
      return
    }
    // Nothing is left of the paragraph: it goes with the blank lines after it, or, last, with
    // those after the last block that stays.
    dropped.add(index)
    const next = blocks[index + 1]?.position?.start.offset
    if (next !== undefined) {
      edits.push({ start, end: next, text: "" })
      return
    }
    const kept = blocks.findLastIndex((_, i) => i < index && !dropped.has(i))
    const from = kept === -1 ? 0 : (blocks[kept]!.position?.end.offset ?? start)
    // The blocks between were dropped too: this one removal covers them.
    edits.splice(0, edits.length, ...edits.filter((edit) => edit.start < from))
    edits.push({ start: from, end, text: "" })
  })
  return applyEdits(markdown, edits)
}
