import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = fileURLToPath(new URL("../", import.meta.url))

/**
 * The body of the newest CHANGELOG entry — what changesets wrote from the changeset, which is the
 * text written for someone who has never seen the project. Used as the GitHub Release body.
 */
export function newestEntry(changelog: string): { version: string; body: string } {
  const lines = changelog.split("\n")
  const start = lines.findIndex((line) => /^## \d+\.\d+\.\d+/.test(line))
  if (start === -1) throw new Error("no `## X.Y.Z` heading in the changelog")
  const version = lines[start]!.replace(/^##\s+/, "").trim()
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^## \d+\.\d+\.\d+/.test(line))
  return { version, body: (end === -1 ? rest : rest.slice(0, end)).join("\n").trim() }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { body } = newestEntry(await readFile(path.join(packageDir, "CHANGELOG.md"), "utf8"))
  process.stdout.write(`${body}\n`)
}
