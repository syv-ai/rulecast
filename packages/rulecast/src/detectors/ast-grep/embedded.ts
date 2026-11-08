import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { tmpdir, userInfo } from "node:os"
import path from "node:path"

import { cacheHome, type Env } from "../../core/home"
import { VERSION } from "../../core/version"

/**
 * The standalone binary's dynamic languages. Under Node, `@ast-grep/lang-python` finds its prebuilt
 * parser next to itself in node_modules. In the binary there is no node_modules: bun bakes the
 * build machine's path into the package and does not embed the parser, so every ast-grep rule failed
 * on any other machine. scripts/build-binary.ts therefore leaves the package out, embeds the parser
 * file itself, and sets this global, read once by load.ts, before the CLI starts.
 */
export const EMBEDDED_KEY = "__rulecastEmbeddedLanguages"

/** What ast-grep's registerDynamicLanguage needs, with the parser as a path inside the binary. */
export interface EmbeddedLanguage {
  file: string
  extensions: string[]
  languageSymbol: string
  expandoChar?: string
}

/**
 * The binary's copy of `@ast-grep/napi`'s native module, as a path inside the binary. Left to bun,
 * it is written to a fresh temp path and loaded from there in every process, and macOS checks a
 * library at a new path on its first load, which costs about 250 ms per hook. load.ts unpacks it
 * once instead and points napi-rs's loader at the copy. A global of its own, beside the languages.
 */
export const EMBEDDED_NAPI_KEY = "__rulecastEmbeddedNapi"

/** The embedded napi module's path inside the binary, or undefined outside it. */
export function embeddedNapi(): string | undefined {
  return (globalThis as Record<string, unknown>)[EMBEDDED_NAPI_KEY] as string | undefined
}

/** Whether this process is the standalone binary: its entry sets the embedded globals before the CLI starts. */
export function isStandaloneBinary(): boolean {
  return (globalThis as Record<string, unknown>)[EMBEDDED_KEY] !== undefined
}

/** The embedded registration for a language, or undefined outside the binary. */
export function embeddedLanguage(name: string): EmbeddedLanguage | undefined {
  const all = (globalThis as Record<string, unknown>)[EMBEDDED_KEY] as Record<string, EmbeddedLanguage> | undefined
  return all?.[name]
}

/**
 * The embedded parser as a real file: ast-grep loads it with the system's library loader, which
 * cannot read bun's virtual file system. Copied once into the cache home, keyed by version and
 * platform, and reused while it has the embedded file's size; written to a temp name and renamed,
 * so two hooks starting at once never load a half-written file. When the cache home cannot be
 * written, the temp directory is used instead.
 */
export async function unpack(file: string, name: string, env: Env): Promise<string> {
  // Stat, then read only to write: napi's module is 7 MB, and every hook in the binary asks.
  const { size } = await stat(file)
  let bytes: Buffer | undefined
  const dirName = `${VERSION}-${process.platform}-${process.arch}`
  const dirs = [
    path.join(cacheHome(env), "native", dirName),
    path.join(tmpdir(), `rulecast-native-${userInfo().uid}`, dirName),
  ]
  let failure: unknown
  for (const dir of dirs) {
    const target = path.join(dir, `${name}${path.extname(file)}`)
    try {
      if ((await stat(target).catch(() => null))?.size === size) return target
      await mkdir(dir, { recursive: true })
      const partial = `${target}.${process.pid}.tmp`
      // Read, not copyFile: the copy syscall cannot read from bun's virtual file system.
      bytes ??= await readFile(file)
      await writeFile(partial, bytes)
      await rename(partial, target)
      return target
    } catch (error) {
      failure = error
    }
  }
  throw failure
}
