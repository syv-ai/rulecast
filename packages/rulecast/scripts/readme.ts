import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The README lives once, at the repository root. npm renders the *package's* README on the package
 * page, so this mirrors it. Committed and checked rather than generated at publish time: a README
 * that only exists after a build is a README nobody reviews.
 */
export const README_HEADER = "<!-- Generated from the repository README by `pnpm readme`. Do not edit by hand. -->\n\n"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
const packageDir = fileURLToPath(new URL("../", import.meta.url))

/**
 * npmjs.com resolves a README's relative links against the package's own directory — which, with
 * `repository.directory` set to packages/rulecast, means `agents/SETUP.md` and `LICENSE` both 404
 * on the package page. Absolute blob URLs are the only form that works in both places.
 */
export function absoluteLinks(markdown: string): string {
  return markdown.replace(/\]\((?!https?:|#)([^)]+)\)/g, "](https://github.com/syv-ai/rulecast/blob/main/$1)")
}

export async function packageReadme(): Promise<string> {
  return README_HEADER + absoluteLinks(await readFile(path.join(repoRoot, "README.md"), "utf8"))
}

/** The license text ships in the tarball: npm renders `license: MIT` but carries no text without it. */
export async function packageLicense(): Promise<string> {
  return readFile(path.join(repoRoot, "LICENSE"), "utf8")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files: [string, string][] = [
    [path.join(packageDir, "README.md"), await packageReadme()],
    [path.join(packageDir, "LICENSE"), await packageLicense()],
  ]
  if (process.argv.includes("--check")) {
    for (const [target, generated] of files) {
      if ((await readFile(target, "utf8").catch(() => null)) !== generated) {
        process.stderr.write(`packages/rulecast/${path.basename(target)} is stale: run pnpm readme\n`)
        process.exitCode = 1
      }
    }
  } else {
    for (const [target, generated] of files) await writeFile(target, generated)
    process.stdout.write("wrote packages/rulecast/README.md and LICENSE\n")
  }
}
