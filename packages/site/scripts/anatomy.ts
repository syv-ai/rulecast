import { exampleBinding, exampleRule, openingOutput } from "./sources"

/**
 * The rule-anatomy graphic's two panes, as HTML: the README's example rule and the output it
 * produces. Two things are lit in both: the message, and the doc section the rule's context
 * brings with it. One line per line, for a <pre>.
 */
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const line = (html: string, lit: boolean) => `<span class="rc-a-line${lit ? " rc-a-lit" : ""}">${html}</span>`
const SECTION_HEADER = /^-{3} .* -{3}$/

export function anatomy(): { ruleHtml: string; outputHtml: string } {
  let inContext = false
  const ruleHtml = exampleRule()
    .split("\n")
    .map((text) => {
      if (/^\s*context:/.test(text)) inContext = true
      else if (inContext && !/^\s*- /.test(text)) inContext = false
      return line(escapeHtml(text), inContext || /^\s*message:/.test(text))
    })
    .join("\n")

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
      return line(escapeHtml(text), inSection)
    })
    .join("\n")
  return { ruleHtml, outputHtml }
}
