export interface Heading {
  level: number
  text: string
  slug: string
  /** 1-based line of the heading text. */
  line: number
}

export interface Section {
  slug: string
  /** 1-based, inclusive. */
  start: number
  end: number
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const SETEXT_1 = /^ {0,3}=+[ \t]*$/
const SETEXT_2 = /^ {0,3}-+[ \t]*$/
const LIST_ITEM = /^ {0,3}[-*+][ \t]/

function linesOf(markdown: string): string[] {
  return markdown.split(/\r?\n/)
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-")
}

export function scanHeadings(markdown: string): Heading[] {
  const lines = linesOf(markdown)
  const headings: Heading[] = []
  const seen = new Map<string, number>()
  let fence: { char: string; length: number } | null = null

  const add = (level: number, text: string, line: number) => {
    const base = slugify(text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headings.push({ level, text, slug: count === 0 ? base : `${base}-${count}`, line })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (fence) {
      const close = line.match(FENCE_CLOSE)
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null
      continue
    }
    const open = line.match(FENCE_OPEN)
    if (open) {
      fence = { char: open[1]![0]!, length: open[1]!.length }
      continue
    }
    const atx = line.match(ATX)
    if (atx) {
      add(atx[1]!.length, (atx[2] ?? "").trim(), i + 1)
      continue
    }
    const next = lines[i + 1]
    if (next === undefined || line.trim() === "") continue
    if (SETEXT_1.test(next)) {
      add(1, line.trim(), i + 1)
      i++
    } else if (SETEXT_2.test(next) && !LIST_ITEM.test(line)) {
      add(2, line.trim(), i + 1)
      i++
    }
  }
  return headings
}

export function sectionRange(markdown: string, slug: string): Section | null {
  return sectionRanges(markdown).get(slug) ?? null
}

/** Every section of a file by slug, from one scan: for callers that look up many anchors in one file. */
export function sectionRanges(markdown: string): Map<string, Section> {
  const headings = scanHeadings(markdown)
  const lineCount = linesOf(markdown).length
  const ranges = new Map<string, Section>()
  // A section ends before the next heading at its level or above: walked from the end with a stack
  // of the headings still open, so the whole file is one pass.
  const open: { heading: Heading; index: number }[] = []
  const ends: number[] = new Array(headings.length).fill(lineCount)
  for (const [index, heading] of headings.entries()) {
    while (open.length > 0 && open.at(-1)!.heading.level >= heading.level) ends[open.pop()!.index] = heading.line - 1
    open.push({ heading, index })
  }
  for (const [index, heading] of headings.entries())
    if (!ranges.has(heading.slug))
      ranges.set(heading.slug, { slug: heading.slug, start: heading.line, end: ends[index]! })
  return ranges
}

export function sectionText(markdown: string, section: Section): string {
  return linesOf(markdown)
    .slice(section.start - 1, section.end)
    .join("\n")
    .trimEnd()
}

export function sectionContains(markdown: string, parentSlug: string, childSlug: string): boolean {
  const ranges = sectionRanges(markdown)
  return rangeContains(ranges.get(parentSlug), ranges.get(childSlug))
}

/** Whether section `child` lies inside section `parent`; false when either does not exist. */
export function rangeContains(parent: Section | undefined, child: Section | undefined): boolean {
  if (!parent || !child) return false
  return child.start >= parent.start && child.end <= parent.end
}
