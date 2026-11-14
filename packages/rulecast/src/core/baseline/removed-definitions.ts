import { fileAtCommit } from "../git"
import type { RemovedDefinition } from "../types"

/** Words that may come before a definition's keyword: `export`, `pub(crate)`, `public final`, `data`, `case`. */
const MODIFIER =
  "(?:export|default|declare|pub(?:\\([\\w:]+\\))?|public|private|protected|internal|fileprivate|open|static|final|sealed|abstract|async|data|case|inner|annotation|value|partial|readonly|unsafe|override|inline|suspend|virtual|extern|companion)"

/** A definition's keyword and what follows it up to the name: `class `, `function* `, Go's `func (r *T) `. */
const KEYWORD =
  "(?:(?:class|def|function|interface|type|struct|enum|trait|fn|func|fun|const|object|record|module|namespace|impl|protocol|extension|typealias)\\s+|function\\s*\\*\\s*|func\\s+\\([^)]*\\)\\s*)"

/** Java and C# methods name no keyword: modifiers, a return type, then the name and its parameters. */
const ACCESS =
  "(?:public|private|protected|internal|static|final|abstract|synchronized|override|virtual|async|sealed|partial|native)"

/** Statements that can follow `async` or `static`: `async with`, `async for`, `static assert(`. */
const STATEMENT = "(?:with|for|if|while|return|assert|await|yield|new|throw|switch|catch|in)\\b"

/**
 * A method: the modifiers taken whole (a lookahead and a backreference, as JS has no atomic group,
 * so a line of modifiers cannot be re-split between them and the type), at most four words of
 * return type, then the name and `(`. Linear in the line's length.
 */
const METHOD = `(?=((?:${ACCESS}\\s+)+))\\1(?!${STATEMENT})(?:[\\w$.<>\\[\\]?,]+\\s+){0,4}[\\w$]+\\s*\\(`

/** Annotations or attributes on the definition's own line: `@Override`, `@objc`, `[Serializable]`. */
const ATTRIBUTES = "(?:(?:@[\\w.]+(?:\\([^)]*\\))?|\\[[^\\]]*\\])\\s+)*"

/**
 * A line that defines something, in the languages people write: `class X`, `def f`, `function f`,
 * `interface X`, `type X =`, `struct`, `enum`, `trait`, `fn`, `func`, `fun`, `const X`, with the
 * modifiers Java, C#, Kotlin, Swift, Rust and TypeScript put first, Go methods, and Java or C#
 * methods (`private static void total(`). A heuristic: it only has to find the names a model needs
 * to tell a moved definition from a new one.
 */
const DEFINITION = new RegExp(`^\\s*${ATTRIBUTES}(?:(?:${MODIFIER}\\s+)*${KEYWORD}[\\w$]+|${METHOD})`)

/** Longer lines are data or generated code, not a definition a person moved; skipping them bounds the work. */
const MAX_LINE = 500

export function isDefinition(line: string): boolean {
  return line.length <= MAX_LINE && DEFINITION.test(line)
}

/**
 * The definitions `files` held at `commit` that they no longer hold: deleted files' all of them,
 * changed files' those whose line is no longer anywhere in the file (#72). Read from the commit,
 * since a session's snapshots keep line hashes, not text; a file new since then has none. Not
 * capped: what a prompt shows depends on which file it is for (detectors/llm).
 */
export async function removedDefinitions(
  root: string,
  files: readonly string[],
  commit: string,
  read: (file: string) => Promise<string | null>,
): Promise<RemovedDefinition[]> {
  const removed: RemovedDefinition[] = []
  for (const file of [...new Set(files)].sort()) {
    const before = await fileAtCommit(root, commit, file)
    if (before === null) continue
    const now = new Set(((await read(file)) ?? "").split("\n").map((line) => line.trim()))
    for (const line of before.split("\n")) {
      if (isDefinition(line) && !now.has(line.trim())) removed.push({ file, line: line.trim() })
    }
  }
  return removed
}
