import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parse } from "yaml"

/**
 * Every read of the repository's own Markdown goes through here. The site has no copy of the docs:
 * its pages are cut from README.md and agents/ at build time, so a page cannot say something its
 * source does not.
 */
export const REPO_ROOT = repoRoot()

/**
 * The workspace root, found from the working directory rather than this file's URL: Astro bundles
 * this module into dist/ before running it, so `import.meta.url` is not where this file lives.
 */
function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir
    if (path.dirname(dir) === dir) throw new Error(`no pnpm-workspace.yaml above ${process.cwd()}`)
  }
}

export type PageSource =
  /** README sections, in this order, by their `##` heading. `LEAD` is the text above the first one. */
  | { readme: string[]; file?: string }
  /** One file under agents/, whole. */
  | { file: string }
  /** A hand-written page in src/content/docs/<route>.mdx. */
  | { hand: true }

export interface Page {
  route: string
  title: string
  description: string
  group: string
  source: PageSource
  /** Shown above the source's text: what the site says about a page that was not written for it. */
  intro?: string
}

export const LEAD = "(lead)"

/** Where the site is served: https://syv-ai.github.io/rulecast/. */
export const SITE = "https://syv-ai.github.io"
export const BASE = "/rulecast"
export const SITE_URL = `${SITE}${BASE}/`

/** The note on a page written for agents: they read it raw, at the released tag. */
function forAgents(file: string): string {
  return `:::note[Written for coding agents]\nThis page is the file your agent reads. Give it the raw file at the released tag: <https://raw.githubusercontent.com/syv-ai/rulecast/v${version()}/${file}>\n:::`
}

/** Sidebar groups, in order. */
export const GROUPS = ["Start here", "Guides", "Reference", "For agents"] as const

/** Which source becomes which page. The sidebar, the sync and the link rewriting all read this table. */
export const PAGES: Page[] = [
  {
    route: "getting-started",
    title: "Getting started",
    description: "Install rulecast and set it up with one command.",
    group: "Start here",
    source: { readme: ["Getting started", "Install", "Status"] },
  },
  {
    route: "how-it-works",
    title: "How it works",
    description: "Where rulecast sits between your agent and its tools, and what it costs.",
    group: "Start here",
    source: { hand: true },
  },
  {
    route: "guides/writing-rules",
    title: "Writing rules",
    description: "A rule pairs a check with a message and the doc section it enforces.",
    group: "Guides",
    source: { readme: ["A rule", "Refusing a write", "Turning a rule off"] },
  },
  {
    route: "guides/adopting-rules",
    title: "Adopting rules",
    description: "Adopt a rule on a codebase that already breaks it.",
    group: "Guides",
    source: { readme: ["Adopting a rule on a codebase that already breaks it"] },
  },
  {
    route: "guides/git-hooks-ci",
    title: "Git hooks and CI",
    description: "The same rules in pre-commit, pre-push and CI.",
    group: "Guides",
    source: { readme: ["Git hooks and CI"] },
  },
  {
    route: "guides/agents",
    title: "Agents",
    description: "Let your agent set rulecast up and draft rules from your docs.",
    group: "Guides",
    source: { readme: ["Agents"] },
  },
  {
    route: "reference/commands",
    title: "Commands",
    description: "Every rulecast command.",
    group: "Reference",
    source: { readme: ["Commands"] },
  },
  {
    route: "reference/rule-format",
    title: "Rule format",
    description: "Every key of .rulecast-config.yaml.",
    group: "Reference",
    source: { file: "agents/reference/rule-format.md" },
  },
  {
    route: "reference/detectors",
    title: "Detectors",
    description: "Each detector, its config and its template variables.",
    group: "Reference",
    source: { readme: ["Detectors"], file: "agents/reference/detectors.md" },
  },
  {
    route: "agents/setup",
    title: "SETUP.md",
    description: "The instructions an agent follows to set rulecast up.",
    group: "For agents",
    source: { file: "agents/SETUP.md" },
    intro: forAgents("agents/SETUP.md"),
  },
  {
    route: "agents/draft-rules",
    title: "DRAFT-RULES.md",
    description: "The instructions an agent follows to draft rules from your docs.",
    group: "For agents",
    source: { file: "agents/DRAFT-RULES.md" },
    intro: forAgents("agents/DRAFT-RULES.md"),
  },
]

/**
 * README sections that are not a page of their own. The lead and Performance are imported by
 * how-it-works.mdx; the license is linked from the footer.
 */
export const FRAGMENTS: Record<string, string> = { lead: LEAD, performance: "Performance" }
export const DROPPED = ["License"]

const FENCE = /^(```|~~~)/

/** The README's lead and its `##` sections by heading. A `##` inside a fenced block is not a heading. */
export function readmeSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>()
  let heading = LEAD
  let lines: string[] = []
  let fenced = false
  // The README's pointer to the site is no part of the site.
  const flush = () =>
    sections.set(
      heading,
      lines
        .join("\n")
        .split(/\n\n+/)
        .filter((paragraph) => !paragraph.includes(SITE_URL))
        .join("\n\n")
        .trim(),
    )
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) fenced = !fenced
    const match = fenced ? null : /^## (.+)$/.exec(line)
    if (match) {
      flush()
      heading = match[1]!.trim()
      lines = []
    } else if (heading === LEAD && /^# /.test(line) && lines.length === 0) {
      // The README's own `# rulecast` title: the site has its own.
    } else {
      lines.push(line)
    }
  }
  flush()
  return sections
}

/** A Markdown file's `# ` title and the rest of it. */
export function splitTitle(markdown: string): { title: string | null; body: string } {
  const match = /^# (.+)\n/.exec(markdown)
  return match
    ? { title: match[1]!.trim(), body: markdown.slice(match[0].length).trim() }
    : { title: null, body: markdown }
}

export function readSource(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8")
}

export function readme(): Map<string, string> {
  return readmeSections(readSource("README.md"))
}

/**
 * Throws naming every README section that no page, fragment or drop places, and every placed
 * section the README no longer has. A new README section fails the build until someone decides
 * where it goes.
 */
export function assertPlaced(sections: Map<string, string>): void {
  const placed = [
    ...PAGES.flatMap((page) => ("readme" in page.source ? page.source.readme : [])),
    ...Object.values(FRAGMENTS),
    ...DROPPED,
  ]
  const unplaced = [...sections.keys()].filter((heading) => !placed.includes(heading))
  const missing = placed.filter((heading) => !sections.has(heading))
  const problems = [
    ...unplaced.map(
      (heading) => `README section "${heading}" is on no page: place it in packages/site/scripts/sources.ts`,
    ),
    ...missing.map(
      (heading) =>
        `packages/site/scripts/sources.ts places README section "${heading}", which the README no longer has`,
    ),
  ]
  if (problems.length > 0) throw new Error(problems.join("\n"))
}

/** A piece of a page and the repository file its relative links resolve against. */
export interface PagePart {
  markdown: string
  source: string
}

/**
 * A page's Markdown, in parts, before link rewriting. A README section's heading is dropped when it
 * is the page's title, which Starlight already prints.
 */
export function pageParts(page: Page, sections: Map<string, string>): PagePart[] {
  const parts: PagePart[] = page.intro ? [{ markdown: page.intro, source: "README.md" }] : []
  if ("readme" in page.source) {
    for (const heading of page.source.readme) {
      const text = sections.get(heading) ?? ""
      const markdown = heading === page.title || heading === LEAD ? text : `## ${heading}\n\n${text}`
      parts.push({ markdown, source: "README.md" })
    }
  }
  if ("file" in page.source && page.source.file) {
    parts.push({ markdown: splitTitle(readSource(page.source.file)).body, source: page.source.file })
  }
  return parts
}

export function pageBody(page: Page, sections: Map<string, string>): string {
  return pageParts(page, sections)
    .map((part) => part.markdown)
    .join("\n\n")
}

function firstFence(markdown: string, info: string): string {
  const match = new RegExp(`^\`\`\`${info}\\n([\\s\\S]*?)\\n\`\`\``, "m").exec(markdown)
  if (!match) throw new Error(`no \`\`\`${info} block found`)
  return match[1]!
}

/** The README's example rule: the YAML block of its "A rule" section. */
export function exampleRule(sections = readme()): string {
  return firstFence(sections.get("A rule") ?? "", "yaml")
}

/** The README's opening output, which it says is real output. */
export function openingOutput(sections = readme()): string {
  return firstFence(sections.get(LEAD) ?? "", "")
}

export interface ExampleBinding {
  /** The rule's message template. */
  template: string
  /** The output line the template produced, without its indentation. */
  line: string
  /** Each template variable and the value it took in that line. */
  values: Record<string, string>
}

/**
 * The README's example rule must produce the README's opening output: the site draws an arrow from
 * one to the other. Throws when the rule's message template matches no line of the output.
 */
export function exampleBinding(sections = readme()): ExampleBinding {
  const rule = (parse(exampleRule(sections)) as { repos: { rules: { message: string }[] }[] }).repos[0]!.rules[0]!
  const template = rule.message
  const names: string[] = []
  const pattern = template
    .split(/(\{\{\w+\}\})/)
    .map((part) => {
      const variable = /^\{\{(\w+)\}\}$/.exec(part)
      if (!variable) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      names.push(variable[1]!)
      return "(.+?)"
    })
    .join("")
  for (const raw of openingOutput(sections).split("\n")) {
    const line = raw.trim()
    const match = new RegExp(`^${pattern}$`).exec(line)
    if (match) return { template, line, values: Object.fromEntries(names.map((name, i) => [name, match[i + 1]!])) }
  }
  throw new Error(
    `README.md: the example rule's message (${template}) produces no line of the opening output. The site shows the one producing the other: change one of them.`,
  )
}

/** A recorded renderer output, from packages/rulecast/test/goldens/delivery. */
export function golden(name: string): string {
  return readSource(`packages/rulecast/test/goldens/delivery/${name}.expected.txt`)
}

/** The released version, from the CLI's package.json. */
export function version(): string {
  return JSON.parse(readSource("packages/rulecast/package.json")).version
}
