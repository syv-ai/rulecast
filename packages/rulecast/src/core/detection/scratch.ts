import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * Real files for content no file on disk holds, for detectors that hand a path to another program.
 *
 * **The directory is inside the project root, not in `os.tmpdir()`.** Everything a rule's tool
 * needs is found relative to the root or to the file: `linter` and `command` resolve their binaries
 * from `<root>/node_modules/.bin`, and ruff and eslint find their configuration by walking up from
 * the file they are given. From a directory under `/tmp` the file would be checked by whatever
 * happens to be on PATH, with none of the project's configuration. Configuration keyed on the
 * file's own path (eslint `files:` globs, ruff `per-file-ignores`) still sees the scratch prefix,
 * which is why a detector that can be handed content under the real path declares `takesContent`
 * and never comes here.
 *
 * `entries` maps a repo-relative path to its content; each keeps its own path under the scratch
 * directory, because the extension decides the parser and the directory decides what a linter's
 * configuration says about it. `fn` gets the scratch directory's repo-relative name. The directory
 * is removed in a `finally`, also when `fn` throws: a scratch directory left in the repository on
 * every failing run is how somebody ends up committing one.
 */
export async function withScratchTree<T>(
  root: string,
  prefix: string,
  entries: ReadonlyMap<string, string>,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = path.basename(await mkdtemp(path.join(root, prefix)))
  try {
    for (const [file, content] of entries) {
      const full = path.join(root, dir, file)
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, content)
    }
    return await fn(dir)
  } finally {
    await rm(path.join(root, dir), { recursive: true, force: true })
  }
}
