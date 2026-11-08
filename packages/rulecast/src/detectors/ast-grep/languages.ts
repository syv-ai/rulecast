/**
 * The languages a rule may name. `@ast-grep/napi` builds in five; Python comes from a separate
 * package whose prebuilt parser is registered at runtime (see load.ts). `tsx` also handles `.jsx`.
 *
 * A dynamic language is loaded inside a thunk, only when an ast-grep rule needs one. The standalone
 * binary never loads the package: it embeds the parser itself (see embedded.ts).
 */
export const LANGUAGES = {
  css: { builtin: "Css" },
  html: { builtin: "Html" },
  javascript: { builtin: "JavaScript" },
  python: { load: () => import("@ast-grep/lang-python") },
  tsx: { builtin: "Tsx" },
  typescript: { builtin: "TypeScript" },
} as const satisfies Record<string, { builtin: string } | { load: () => Promise<unknown> }>

export type Language = keyof typeof LANGUAGES

export const LANGUAGE_NAMES = Object.keys(LANGUAGES) as [Language, ...Language[]]

/** The name to hand `parse`: the built-in enum member, or the key the dynamic language registered under. */
export function napiLanguage(language: Language): string {
  const entry: { builtin: string } | { load: () => Promise<unknown> } = LANGUAGES[language]
  return "builtin" in entry ? entry.builtin : language
}
