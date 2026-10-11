import { exampleBinding, exampleRule, exampleSection, openingOutput } from "./sources"

/**
 * The rule-anatomy graphic's two panes, as HTML: the README's example rule, highlighted as YAML,
 * and the output it produces. In both, the message and the doc section the rule's context brings
 * sit on a faint band. Each line is its own block, so they are joined with nothing.
 */
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const span = (kind: string, html: string) => (html ? `<span class="rc-y-${kind}">${html}</span>` : "")
const line = (html: string, lit: boolean) => `<span class="rc-a-line${lit ? " rc-a-lit" : ""}">${html}</span>`
const SECTION_HEADER = /^-{3} .* -{3}$/

/** A YAML scalar: quoted strings with their `{{variables}}` marked, numbers and booleans, bare text. */
function scalar(text: string): string {
  if (/^(['"]).*\1$/.test(text)) {
    return span(
      "str",
      escapeHtml(text).replace(/\{\{\w+\}\}/g, (variable) => span("var", variable)),
    )
  }
  if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(text)) return span("lit", escapeHtml(text))
  if (/^\{\s*\}$|^\[.*\]$/.test(text)) return span("punct", escapeHtml(text))
  return span("str", escapeHtml(text))
}

/** One line of the README's example rule, which uses only block mappings, lists and scalars. */
export function highlightYaml(text: string): string {
  const pair = /^(\s*)(- )?([\w.-]+)(:)(\s*)(.*)$/.exec(text)
  if (pair) {
    const [, indent = "", dash = "", key = "", colon = "", gap = "", value = ""] = pair
    return indent + span("punct", dash) + span("key", key) + span("punct", colon) + gap + scalar(value)
  }
  const item = /^(\s*)(- )(.*)$/.exec(text)
  if (item) return item[1] + span("punct", item[2] ?? "") + scalar(item[3] ?? "")
  return escapeHtml(text)
}

/** One line of rulecast's output: the severity, the cited doc section and its heading stand out. */
function highlightOutput(text: string): string {
  const finding = /^(error|warning)( .*)$/.exec(text)
  if (finding) return span(finding[1] ?? "", finding[1] ?? "") + span("key", escapeHtml(finding[2] ?? ""))
  if (SECTION_HEADER.test(text)) return span("var", escapeHtml(text))
  if (/^#+ /.test(text)) return span("heading", escapeHtml(text))
  return escapeHtml(text)
}

export function anatomy(): { ruleHtml: string; outputHtml: string } {
  let inContext = false
  const ruleHtml = exampleRule()
    .split("\n")
    .map((text) => {
      if (/^\s*context:/.test(text)) inContext = true
      else if (inContext && !/^\s*- /.test(text)) inContext = false
      return line(highlightYaml(text), inContext || /^\s*message:/.test(text))
    })
    .join("")

  const binding = exampleBinding()
  const messageHtml = `  ${binding.template
    .split(/(\{\{\w+\}\})/)
    .map((part) => {
      const variable = /^\{\{(\w+)\}\}$/.exec(part)?.[1]
      if (!variable) return escapeHtml(part)
      return `<span class="rc-a-value" title="{{${variable}}}">${escapeHtml(binding.values[variable] ?? "")}</span>`
    })
    .join("")}`
  let inSection = false
  const outputHtml = openingOutput()
    .split("\n")
    .map((text) => {
      if (SECTION_HEADER.test(text)) inSection = true
      if (text.trim() === binding.line) return line(messageHtml, true)
      return line(highlightOutput(text), inSection)
    })
    .join("")
  return { ruleHtml, outputHtml }
}

/** Inline Markdown: code and emphasis, which is all the README's prose and doc sections use. */
export function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
}

/**
 * The convention-to-rule picture: the doc section the README's example rule cites, as headings and
 * paragraphs, and the whole rule but its `name` (a label, not behaviour), with context on the band.
 * Nothing that makes it a check may be cut: a rule with `context` and no `detect` catches nothing.
 */
export function conventionFlow(): { file: string; sectionHtml: string; ruleHtml: string } {
  const section = exampleSection()
  const sectionHtml = section.text
    .split(/\n\n+/)
    .map((block) => {
      const heading = /^#+ (.*)$/.exec(block)
      return heading ? `<p class="rc-doc-h">${inlineHtml(heading[1] ?? "")}</p>` : `<p>${inlineHtml(block)}</p>`
    })
    .join("")
  // The rule's own lines, so its quoting and escapes are the README's, outdented to the list item.
  const lines = exampleRule().split("\n")
  const start = lines.findIndex((text) => /^\s*- id:/.test(text))
  const indent = /^\s*/.exec(lines[start] ?? "")?.[0].length ?? 0
  const ruleHtml = lines
    .slice(start)
    .filter((text) => text.trim() !== "" && !/^\s*name:/.test(text))
    .map((text) => {
      const lit = /^\s*context:/.test(text) || /^\s*- "?@/.test(text)
      return line(highlightYaml(text.slice(indent)), lit)
    })
    .join("")
  return { file: section.file, sectionHtml, ruleHtml }
}
