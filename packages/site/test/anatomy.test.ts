import { describe, expect, it } from "vitest"
import { anatomy, highlightYaml } from "../scripts/anatomy"

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
const litLines = (html: string) =>
  html
    .split(/(?=<span class="rc-a-line)/)
    .filter((line) => line.includes("rc-a-lit"))
    .map(text)

describe("highlightYaml", () => {
  it("marks keys, punctuation, strings and the variables inside them", () => {
    const html = highlightYaml('        message: "{{file}} is wrong"')
    expect(html).toBe(
      '        <span class="rc-y-key">message</span><span class="rc-y-punct">:</span> <span class="rc-y-str">"<span class="rc-y-var">{{file}}</span> is wrong"</span>',
    )
  })

  it("marks a list item and a key under a dash", () => {
    expect(highlightYaml("  - repo: local")).toContain(
      '<span class="rc-y-punct">- </span><span class="rc-y-key">repo</span>',
    )
    expect(highlightYaml('    - "@docs/a.md#b"')).toContain('<span class="rc-y-str">"@docs/a.md#b"</span>')
  })

  it("keeps the text exactly", () => {
    const yaml = "    pattern: 'raise\\s+HTTPException\\((?<args>[^)]*)\\)'"
    expect(text(highlightYaml(yaml))).toBe(yaml)
  })
})

describe("anatomy", () => {
  const { ruleHtml, outputHtml } = anatomy()

  it("puts the rule's message and context on the band", () => {
    expect(litLines(ruleHtml).join("\n")).toMatch(/message:[\s\S]*context:[\s\S]*@conventions\/backend\.md#errors/)
    expect(litLines(ruleHtml).some((line) => line.trim().startsWith("files:"))).toBe(false)
  })

  it("puts the output's message, with each template value marked, and the doc section on the band", () => {
    expect(outputHtml).toContain('<span class="rc-a-value" title="{{args}}">404</span>')
    expect(litLines(outputHtml)).toContain("--- conventions/backend.md#errors ---")
    expect(litLines(outputHtml).some((line) => line.startsWith("rulecast:"))).toBe(false)
  })
})
