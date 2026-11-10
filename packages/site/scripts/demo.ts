import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { golden, openingOutput, REPO_ROOT } from "./sources"

/**
 * The README's terminal demo: the session the site's TerminalDemo replays, as an animated SVG that
 * GitHub and npm can show. Every line rulecast prints in it is real output, read from the same
 * places: the README's opening block (kept under the demo as text) and the renderer's recorded
 * `shell-edit` golden. Only the agent's own actions are written here.
 *
 *   tsx scripts/demo.ts          writes .github/assets/demo.svg
 *   tsx scripts/demo.ts --check  exits 1 when it is stale
 *
 * With reduced motion, the whole session simply shows.
 */
export const DEMO_PATH = ".github/assets/demo.svg"

type Kind = "agent" | "rulecast" | "note"
interface Line {
  kind: Kind
  text: string
}

const agent = (text: string): Line => ({ kind: "agent", text })
const note = (text: string): Line => ({ kind: "note", text })
const output = (text: string): Line[] =>
  text
    .trimEnd()
    .split("\n")
    .map((line) => ({ kind: "rulecast" as const, text: line }))

export function session(): Line[] {
  return [
    agent("Edit app/services/users.py"),
    ...output(openingOutput()),
    agent("Edit app/services/users.py"),
    note("(fixed: nothing to report)"),
    agent("Bash python scripts/scaffold_service.py users"),
    ...output(golden("shell-edit")),
  ]
}

// Layout, in px. CHAR is a monospace advance at FONT (0.6em); lines wrap to fit WIDTH.
const WIDTH = 860
const FONT = 13
const CHAR = FONT * 0.6
const ROW = 20
const PAD_X = 28
const TOP = 52
const BOTTOM = 26
const INDENT = 18
const AGENT_GAP = 12
const COLUMNS = Math.floor((WIDTH - 2 * PAD_X - INDENT) / CHAR)

// The site's terminal colours (packages/site/src/styles/theme.css).
const BG = "#18181d"
const FG = "#ececf1"
const DIM = "#9a9aa4"
const SIGNAL = "#7fa4d6"
const ERROR = "#f27c7c"
const WARNING = "#e8c27a"
const SECTION = "#d3a9df"
const BAND = "rgba(127,164,214,0.12)"

// Timing, in ms, as TerminalDemo replays it.
const PAUSE_BEFORE_AGENT = 400
const PER_CHAR = 24
const AFTER_TYPING = 450
const PER_OUTPUT_LINE = 60
const AFTER_OUTPUT = 2600
const AFTER_NOTE = 1400
const HOLD_AT_END = 4000
const FADE = 320

/** A line cut into rows of at most `columns` characters at spaces, continuation rows indented by two. */
export function wrap(text: string, columns: number): string[] {
  const indent = " ".repeat(/^ */.exec(text)![0].length + 2)
  const rows: string[] = []
  let rest = text
  while (rest.length > columns) {
    let cut = rest.lastIndexOf(" ", columns)
    if (cut <= indent.length) cut = columns
    rows.push(rest.slice(0, cut))
    rest = indent + rest.slice(cut).trimStart()
  }
  rows.push(rest)
  return rows
}

/**
 * A row of text, held to CHAR per character whatever monospace font the viewer has, so rows wrap
 * and the typing cover moves as laid out here.
 */
function text(x: number, y: number, fill: string, row: string, extra = ""): string {
  const length = (row.length * CHAR).toFixed(1)
  return `<text x="${x}" y="${y}" fill="${fill}" textLength="${length}" lengthAdjust="spacingAndGlyphs"${extra}>${escapeXml(row)}</text>`
}

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function colour(line: Line): string {
  if (line.kind === "agent") return "#ffffff"
  if (line.kind === "note") return DIM
  if (/^rulecast:/.test(line.text)) return FG
  if (/^error /.test(line.text)) return ERROR
  if (/^warning /.test(line.text)) return WARNING
  if (/^-{3} .* -{3}$/.test(line.text)) return SECTION
  return DIM
}

/** Each line with the time it appears and, for an agent line, when its typing ends. */
function timeline(lines: Line[]): { starts: number[]; typed: number[]; total: number } {
  const starts: number[] = []
  const typed: number[] = []
  let t = 0
  lines.forEach((line, i) => {
    if (line.kind === "agent") {
      t += PAUSE_BEFORE_AGENT
      starts.push(t)
      t += line.text.length * PER_CHAR
      typed.push(t)
      t += AFTER_TYPING
    } else {
      starts.push(t)
      typed.push(t)
      t += line.kind === "note" ? AFTER_NOTE : PER_OUTPUT_LINE
      if (line.kind === "rulecast" && lines[i + 1]?.kind !== "rulecast") t += AFTER_OUTPUT
    }
  })
  return { starts, typed, total: t + HOLD_AT_END + FADE }
}

export function renderDemo(lines: Line[] = session()): string {
  const { starts, typed, total } = timeline(lines)
  const pct = (ms: number) => ((ms / total) * 100).toFixed(3)
  const fadeAt = pct(total - FADE)
  const styles: string[] = []
  const body: string[] = []
  let y = TOP
  let inSection = false

  lines.forEach((line, i) => {
    if (line.kind !== "rulecast") inSection = false
    else if (/^-{3} .* -{3}$/.test(line.text)) inSection = true
    if (line.kind === "agent" && i > 0) y += AGENT_GAP
    const x = line.kind === "agent" ? PAD_X : PAD_X + INDENT
    const rows = line.kind === "agent" ? [line.text] : wrap(line.text, COLUMNS)
    const parts: string[] = []
    for (const row of rows) {
      const baseline = y + ROW * 0.7
      if (inSection) parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${ROW}" fill="${BAND}"/>`)
      if (line.kind === "agent") {
        parts.push(text(PAD_X, baseline, SIGNAL, "›"))
        parts.push(text(PAD_X + INDENT, baseline, colour(line), row))
      } else {
        const style = line.kind === "note" ? ` font-style="italic"` : ""
        const fill = inSection && line.kind === "rulecast" && colour(line) === DIM ? FG : colour(line)
        if (row.trim() !== "") parts.push(text(x, baseline, fill, row, style))
      }
      y += ROW
    }
    const start = pct(starts[i]!)
    const visible = (Number(start) + 0.001).toFixed(3)
    styles.push(`@keyframes l${i}{0%,${start}%{opacity:0}${visible}%,${fadeAt}%{opacity:1}100%{opacity:0}}`)
    styles.push(`.l${i}{animation:l${i} ${total}ms linear infinite}`)
    if (line.kind === "agent") {
      // A cover in the terminal's colour slides off the command, a character at a time. It shows only
      // when the animation runs, so with reduced motion the command is simply there.
      const width = Number((line.text.length * CHAR).toFixed(1))
      const end = pct(typed[i]!)
      styles.push(
        `@keyframes c${i}{0%,${start}%{transform:translateX(0)}${end}%,100%{transform:translateX(${width}px)}}`,
        `.c${i}{opacity:1;animation:c${i} ${total}ms steps(${line.text.length}) infinite}`,
      )
      parts.push(
        `<rect class="c${i}" x="${PAD_X + INDENT}" y="${y - ROW}" width="${width}" height="${ROW}" fill="${BG}" opacity="0"/>`,
      )
    }
    body.push(`<g class="l${i}">${parts.join("")}</g>`)
  })

  const height = y + BOTTOM
  const dots = [
    ["#ff5f57", 20],
    ["#febc2e", 40],
    ["#28c840", 60],
  ]
    .map(([fill, cx]) => `<circle cx="${cx}" cy="20" r="6" fill="${fill}"/>`)
    .join("")
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="An agent session with rulecast: real rulecast output">`,
    `<style>text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:${FONT}px;white-space:pre}@media (prefers-reduced-motion:no-preference){${styles.join("")}}</style>`,
    `<defs><clipPath id="w"><rect width="${WIDTH}" height="${height}" rx="12"/></clipPath></defs>`,
    `<g clip-path="url(#w)">`,
    `<rect width="${WIDTH}" height="${height}" fill="${BG}"/>`,
    dots,
    `<text x="${WIDTH / 2}" y="24" fill="${DIM}" text-anchor="middle">agent session · rulecast</text>`,
    ...body,
    `</g>`,
    `</svg>`,
    "",
  ].join("\n")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = path.join(REPO_ROOT, DEMO_PATH)
  const svg = renderDemo()
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== svg) {
      process.stderr.write(`${DEMO_PATH} is stale: run pnpm demo\n`)
      process.exitCode = 1
    }
  } else {
    writeFileSync(target, svg)
    process.stdout.write(`wrote ${DEMO_PATH}\n`)
  }
}
