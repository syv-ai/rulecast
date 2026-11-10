import { readFileSync } from "node:fs"

/**
 * The docs' code-block themes, for Expressive Code, in the landing page's syntax colours: the
 * `--rc-syn-*` tokens in theme.css, read from it at build time so the two cannot drift. Keys are
 * the muted blue, strings green, values and variables violet, punctuation and comments grey, and
 * everything else, a shell command's arguments too, the body text.
 *
 * Expressive Code then raises any colour below its minimum contrast (5.5:1, its default) against
 * the block's background, and the grey is: code blocks show punctuation and comments lighter in
 * the dark theme (#7c7c87 becomes #9c9ca4) and darker in the light one (#8a8a94 becomes #63636a).
 * The other tokens come through as theme.css has them. That is left on, so comments stay readable;
 * the landing page's own code (the `.rc-y-*` spans), outside Expressive Code, keeps theme.css's grey.
 */
const THEME_CSS = new URL("../src/styles/theme.css", import.meta.url)

type Mode = "dark" | "light"
type Tokens = { key: string; string: string; var: string; punct: string; text: string }

/** The custom properties set in the first rule whose selector is exactly `selector`. */
function block(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[[\]"]/g, (char) => `\\${char}`)
  const body = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
  if (!body) throw new Error(`theme.css has no ${selector} rule`)
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))
}

export function syntaxTokens(css: string, mode: Mode): Tokens {
  const props = block(css, mode === "dark" ? ":root" : ':root[data-theme="light"]')
  const get = (name: string) => {
    const value = props.get(name)
    if (!value) throw new Error(`theme.css sets no ${name} for ${mode}`)
    return value
  }
  return {
    key: get("--rc-syn-key"),
    string: get("--rc-syn-string"),
    var: get("--rc-syn-var"),
    punct: get("--rc-syn-punct"),
    text: get("--sl-color-gray-1"),
  }
}

/** A VS Code-style theme, which Expressive Code takes as it is. */
export function codeTheme(tokens: Tokens, mode: Mode) {
  const rule = (foreground: string, scope: string[]) => ({ scope, settings: { foreground } })
  return {
    name: `rulecast-${mode}`,
    type: mode,
    colors: { "editor.foreground": tokens.text },
    tokenColors: [
      rule(tokens.key, [
        "entity.name.tag",
        "support.type.property-name",
        "meta.object-literal.key",
        "keyword",
        "storage",
        "entity.name.function",
        "support.function",
        "entity.name.command",
      ]),
      rule(tokens.string, ["string", "punctuation.definition.string", "markup.inline.raw"]),
      rule(tokens.var, [
        "constant.numeric",
        "constant.language",
        "constant.character",
        "variable.other.normal",
        "variable.parameter",
        "punctuation.definition.variable",
        "punctuation.definition.template-expression",
      ]),
      rule(tokens.punct, ["comment", "punctuation", "keyword.operator", "meta.brace"]),
      // A shell command's arguments and flags read as text, as in the landing's terminal.
      rule(tokens.text, ["string.unquoted.argument", "constant.other.option"]),
    ],
  }
}

export function codeThemes(css = readFileSync(THEME_CSS, "utf8")) {
  return (["dark", "light"] as const).map((mode) => codeTheme(syntaxTokens(css, mode), mode))
}
