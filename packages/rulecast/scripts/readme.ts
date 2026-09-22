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

export async function packageReadme(): Promise<string> {
  return README_HEADER + (await readFile(path.join(repoRoot, "README.md"), "utf8"))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = path.join(packageDir, "README.md")
  const generated = await packageReadme()
  if (process.argv.includes("--check")) {
    const committed = await readFile(target, "utf8").catch(() => null)
    if (committed !== generated) {
      process.stderr.write("packages/rulecast/README.md is stale: run pnpm readme\n")
      process.exitCode = 1
    }
  } else {
    await writeFile(target, generated)
    process.stdout.write("wrote packages/rulecast/README.md\n")
  }
}
