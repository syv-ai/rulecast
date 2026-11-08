import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { EMBEDDED_KEY, EMBEDDED_NAPI_KEY } from "../src/detectors/ast-grep/embedded"

const exec = promisify(execFile)
const packageDir = fileURLToPath(new URL("../", import.meta.url))

/**
 * The platforms 0.1 ships, as `<os>-<arch>`. Each is built on its own runner: `bun build --compile
 * --target=…` would embed whatever `@ast-grep/napi` resolved on the *building* machine, so a Linux
 * binary cross-compiled on macOS carries the darwin .node and dies at the first ast-grep rule —
 * in a way no test on the build machine can see. .github/workflows use these exact strings.
 *
 * No Windows: core/which.ts and detectors/linter/resolve.ts shell out to /bin/sh, commands/spawn.ts
 * assumes POSIX detached spawning, and nothing in the suite would catch a regression there.
 */
export const BINARY_RUNNERS = {
  "linux-x64": "ubuntu-latest",
  "linux-arm64": "ubuntu-24.04-arm",
  "darwin-arm64": "macos-latest",
  // macos-13 was retired on 2025-12-04; macos-15-intel is the Intel image.
  "darwin-x64": "macos-15-intel",
} as const

export const BINARY_TARGETS = Object.keys(BINARY_RUNNERS) as [BinaryTarget, ...BinaryTarget[]]
export type BinaryTarget = keyof typeof BINARY_RUNNERS

/** The target this machine builds for. Throws rather than guessing on a platform 0.1 does not ship. */
export function hostTarget(platform: string = process.platform, arch: string = process.arch): BinaryTarget {
  const target = `${platform}-${arch}`
  if (!(BINARY_TARGETS as readonly string[]).includes(target)) {
    throw new Error(`rulecast does not ship a binary for ${target} (targets: ${BINARY_TARGETS.join(", ")})`)
  }
  return target as BinaryTarget
}

/** Dynamic-language packages: left out of the bundle, their parser embedded by the entry below. */
const DYNAMIC_LANGUAGES = { python: "@ast-grep/lang-python" } as const

/**
 * The package holding this machine's `@ast-grep/napi` native module, and the module's path. Resolved
 * from `@ast-grep/napi` itself, as its loader would: Linux has a glibc and a musl package, and the
 * one installed is the one this machine runs.
 */
export function hostNapi(): { specifier: string; file: string } {
  const require = createRequire(createRequire(path.join(packageDir, "package.json")).resolve("@ast-grep/napi"))
  const base = `@ast-grep/napi-${process.platform}-${process.arch}`
  for (const specifier of [base, `${base}-gnu`, `${base}-musl`]) {
    try {
      return { specifier, file: require.resolve(specifier) }
    } catch {
      // Not this variant; try the next.
    }
  }
  throw new Error(`no @ast-grep/napi native module is installed for ${process.platform}-${process.arch}`)
}

/**
 * The binary's entry: it embeds each dynamic language's prebuilt parser and napi's native module
 * for this machine (bun's `type: "file"` import, which yields a path inside the binary), records
 * what load.ts needs to register and load them, and then starts the CLI. Read at build time from the packages themselves, so their
 * registration never drifts. The packages are `--external`: bundled, they would carry the build
 * machine's node_modules path and look for the parser there.
 */
export function binaryEntry(cli: string): string {
  const require = createRequire(path.join(packageDir, "package.json"))
  const lines: string[] = []
  const languages: string[] = []
  for (const [name, specifier] of Object.entries(DYNAMIC_LANGUAGES)) {
    const entry = require(specifier) as {
      libraryPath: string
      extensions: string[]
      languageSymbol: string
      expandoChar?: string
    }
    lines.push(`import ${name}Parser from ${JSON.stringify(entry.libraryPath)} with { type: "file" }`)
    const rest = { extensions: entry.extensions, languageSymbol: entry.languageSymbol, expandoChar: entry.expandoChar }
    languages.push(`${JSON.stringify(name)}: { file: ${name}Parser, ...${JSON.stringify(rest)} }`)
  }
  lines.push(`import napiModule from ${JSON.stringify(hostNapi().file)} with { type: "file" }`)
  lines.push(`;(globalThis as Record<string, unknown>)[${JSON.stringify(EMBEDDED_KEY)}] = { ${languages.join(", ")} }`)
  lines.push(`;(globalThis as Record<string, unknown>)[${JSON.stringify(EMBEDDED_NAPI_KEY)}] = napiModule`)
  lines.push(`await import(${JSON.stringify(cli)})`)
  return `${lines.join("\n")}\n`
}

/** Builds the standalone binary for this machine at `outfile`, from a fresh `pnpm build`. */
export async function buildBinary(outfile: string): Promise<void> {
  await mkdir(path.dirname(outfile), { recursive: true })
  await exec("pnpm", ["build"], { cwd: packageDir })
  const scratch = await mkdtemp(path.join(tmpdir(), "rulecast-entry-"))
  try {
    const entry = path.join(scratch, "entry.ts")
    await writeFile(entry, binaryEntry(path.join(packageDir, "dist/cli.js")))
    // napi's native package is external too: bundled, bun would embed a second copy of the module
    // and write it to a new temp path on every run. The entry embeds it once, for load.ts to unpack.
    const external = [...Object.values(DYNAMIC_LANGUAGES), hostNapi().specifier].flatMap((specifier) => [
      "--external",
      specifier,
    ])
    await exec("bun", ["build", entry, "--compile", ...external, "--outfile", outfile])
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = hostTarget()
  // Not dist/: package.json's `files` is ["dist"], so a binary left there would be published to
  // npm as a 65 MB tarball the next time anyone ran `pnpm binary` before `pnpm publish`.
  const outfile = path.join(packageDir, "binaries", `rulecast-${target}`)
  await buildBinary(outfile)
  const { size } = await stat(outfile)
  process.stdout.write(`${outfile}\n${(size / 1024 / 1024).toFixed(1)} MB\n`)
}
