import type { SgRoot } from "@ast-grep/napi"

import { errorMessage } from "../../core/errors"
import { LANGUAGES, type Language, napiLanguage } from "./languages"

export interface Parser {
  parse(source: string): SgRoot
}

/**
 * The native module and ast-grep's dynamic-language registration are process-global: the napi
 * docs say registerDynamicLanguage "should be called exactly once in the program", and a second
 * call is ignored, so every dynamic language has to go in one call. This memo is therefore the one
 * place in src/ that keeps module-level state. It caches an idempotent load and holds nothing
 * derived from a rule, a project or an event.
 */
let loading: Promise<typeof import("@ast-grep/napi")> | null = null

async function load(): Promise<typeof import("@ast-grep/napi")> {
  loading ??= (async () => {
    const napi = await import("@ast-grep/napi")
    const dynamic: Record<string, unknown> = {}
    for (const [name, entry] of Object.entries(LANGUAGES)) {
      if (!("load" in entry)) continue
      const module = (await entry.load()) as { default?: unknown }
      dynamic[name] = module.default ?? module
    }
    // One call with every dynamic language: a second call is ignored, so a language registered
    // later would never be available.
    if (Object.keys(dynamic).length > 0) napi.registerDynamicLanguage(dynamic as never)
    return napi
  })()
  return loading
}

export class AstGrepUnavailable extends Error {
  constructor(cause: unknown) {
    super(`ast-grep is unavailable: ${errorMessage(cause)}`)
  }
}

/** A parser for one language. Throws AstGrepUnavailable when the native module cannot be loaded. */
export async function parserFor(language: Language): Promise<Parser> {
  let napi: typeof import("@ast-grep/napi")
  try {
    napi = await load()
  } catch (error) {
    loading = null
    throw new AstGrepUnavailable(error)
  }
  const name = napiLanguage(language)
  return { parse: (source) => napi.parse(name, source) }
}
