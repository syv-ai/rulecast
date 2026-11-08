import type { SgRoot } from "@ast-grep/napi"

import { errorMessage } from "../../core/errors"
import { embeddedLanguage, embeddedNapi, unpack } from "./embedded"
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
let loading: Promise<Loaded> | null = null

interface Loaded {
  napi: typeof import("@ast-grep/napi")
  /** Dynamic languages that could not be registered, with why: the others still work. */
  failed: Map<string, unknown>
}

interface Registration {
  libraryPath: string
  extensions: string[]
  languageSymbol: string
  expandoChar?: string
}

/**
 * A dynamic language's registration, its fields read one by one: a package's `libraryPath` is a
 * getter that throws when the parser is missing, and it must throw here, for this language only,
 * rather than inside registerDynamicLanguage, which would take every language down with it.
 */
async function registration(name: string, load: () => Promise<unknown>): Promise<Registration> {
  const embedded = embeddedLanguage(name)
  if (embedded) {
    const { file, ...rest } = embedded
    return { ...rest, libraryPath: await unpack(file, name, process.env) }
  }
  const module = (await load()) as { default?: Registration } & Registration
  const entry = module.default ?? module
  return {
    libraryPath: entry.libraryPath,
    extensions: entry.extensions,
    languageSymbol: entry.languageSymbol,
    ...(entry.expandoChar === undefined ? {} : { expandoChar: entry.expandoChar }),
  }
}

/**
 * In the binary, napi-rs's loader is pointed at a copy of the embedded module unpacked once into
 * the cache home: it reads NAPI_RS_NATIVE_LIBRARY_PATH before anything else. With nowhere to
 * unpack, it gets the embedded path itself, which bun writes to a fresh temp file per run: slow,
 * but every rule still runs.
 */
async function pointAtEmbeddedNapi(): Promise<void> {
  const embedded = embeddedNapi()
  if (embedded === undefined) return
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = await unpack(embedded, "napi", process.env).catch(() => embedded)
}

async function load(): Promise<Loaded> {
  loading ??= (async () => {
    await pointAtEmbeddedNapi()
    const napi = await import("@ast-grep/napi")
    const dynamic: Record<string, Registration> = {}
    const failed = new Map<string, unknown>()
    for (const [name, entry] of Object.entries(LANGUAGES)) {
      if (!("load" in entry)) continue
      try {
        dynamic[name] = await registration(name, entry.load)
      } catch (error) {
        failed.set(name, error)
      }
    }
    // One call with every dynamic language: a second call is ignored, so a language registered
    // later would never be available.
    if (Object.keys(dynamic).length > 0) napi.registerDynamicLanguage(dynamic as never)
    return { napi, failed }
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
  let loaded: Loaded
  try {
    loaded = await load()
  } catch (error) {
    loading = null
    throw new AstGrepUnavailable(error)
  }
  if (loaded.failed.has(language)) throw new AstGrepUnavailable(loaded.failed.get(language))
  const { napi } = loaded
  const name = napiLanguage(language)
  return { parse: (source) => napi.parse(name, source) }
}
