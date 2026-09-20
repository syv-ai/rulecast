/**
 * The languages a rule may name. `@ast-grep/napi` builds in five; Python comes from a separate
 * package whose prebuilt parser is registered at runtime (see load.ts). `tsx` also handles `.jsx`.
 *
 * A dynamic language's specifier is written out inside a thunk, never resolved from a variable:
 * a bundler has to see the literal to embed the prebuilt parser in a standalone binary.
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
