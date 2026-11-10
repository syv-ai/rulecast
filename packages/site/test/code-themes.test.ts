import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { codeThemes, syntaxTokens } from "../scripts/code-themes"

const css = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8")

describe("code themes", () => {
  it("take the landing page's syntax colours from theme.css, per theme", () => {
    expect(syntaxTokens(css, "dark").key).toMatch(/^#[0-9a-f]{6}$/)
    expect(syntaxTokens(css, "dark").key).not.toBe(syntaxTokens(css, "light").key)
    const [dark, light] = codeThemes(css)
    expect(dark?.type).toBe("dark")
    expect(light?.type).toBe("light")
    const colours = JSON.stringify(light?.tokenColors)
    for (const value of Object.values(syntaxTokens(css, "light"))) expect(colours).toContain(value)
  })

  it("says which token theme.css is missing", () => {
    expect(() => syntaxTokens(":root { --rc-syn-key: #000; }", "dark")).toThrow("--rc-syn-string")
  })
})
