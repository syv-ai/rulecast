import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const packageDir = fileURLToPath(new URL("../", import.meta.url))
const dist = path.join(packageDir, "dist")

/** Everything `exports` in package.json points at. */
const ENTRIES = ["index.d.ts", "internal.d.ts", "cli.d.ts"]

const RELATIVE = /((?:\bfrom|\bimport)\s*\(?\s*)(["'])(\.\.?\/[^"']+)\2/g

/**
 * Rewrites a declaration file's relative imports to the paths Node would load, reporting each
 * declaration it found. `tsc` keeps the source's extensionless imports, which a consumer on
 * `moduleResolution: node16` or `nodenext` cannot follow: in an ESM package each one resolves to
 * nothing, and under `skipLibCheck` that quietly turns the public types into `any`. So an import
 * that points at no declaration throws rather than ship.
 */
export function rewriteSpecifiers(text: string, file: string, found: (declaration: string) => void = () => {}): string {
  return text.replace(RELATIVE, (whole, lead: string, quote: string, specifier: string) => {
    const target = path.resolve(path.dirname(file), specifier)
    for (const [declaration, suffix] of [
      [`${target}.d.ts`, ".js"],
      [path.join(target, "index.d.ts"), "/index.js"],
    ] as const) {
      if (existsSync(declaration)) {
        found(declaration)
        return `${lead}${quote}${specifier}${suffix}${quote}`
      }
    }
    throw new Error(`${file}: ${whole} resolves to no declaration file`)
  })
}

/**
 * TypeScript 7 has no compiler API, so nothing can bundle declarations (`tsup --dts`,
 * rollup-plugin-dts and api-extractor all need one) and `tsc` writes one file per module. Only the
 * files the entry points reach go into dist: the rest describe modules no consumer can import.
 */
async function main(): Promise<void> {
  const out = await mkdtemp(path.join(tmpdir(), "rulecast-declarations-"))
  try {
    const tsc = path.join(packageDir, "node_modules/.bin/tsc")
    const config = path.join(packageDir, "tsconfig.build.json")
    await promisify(execFile)(tsc, ["-p", config, "--outDir", out], { cwd: packageDir })
    const seen = new Set<string>()
    const copy = async (file: string): Promise<void> => {
      if (seen.has(file)) return
      seen.add(file)
      const reached: string[] = []
      const text = rewriteSpecifiers(await readFile(file, "utf8"), file, (declaration) => reached.push(declaration))
      const destination = path.join(dist, path.relative(out, file))
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, text)
      await Promise.all(reached.map(copy))
    }
    await Promise.all(ENTRIES.map((entry) => copy(path.join(out, entry))))
    console.log(`DTS ${seen.size} declaration files in dist`)
  } finally {
    await rm(out, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
