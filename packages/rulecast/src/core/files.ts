import path from "node:path"

import { errorMessage } from "./errors"

/** Extension (lowercase, with the dot) → file-type tags, after pre-commit's identify. Every file also has "file". */
export const TYPE_TABLE: Readonly<Record<string, readonly string[]>> = {
  ".py": ["text", "python"],
  ".pyi": ["text", "python", "pyi"],
  ".ts": ["text", "ts"],
  ".mts": ["text", "ts"],
  ".cts": ["text", "ts"],
  ".tsx": ["text", "tsx"],
  ".js": ["text", "javascript"],
  ".mjs": ["text", "javascript"],
  ".cjs": ["text", "javascript"],
  ".jsx": ["text", "jsx"],
  ".md": ["text", "markdown"],
  ".mdx": ["text", "mdx"],
  ".yaml": ["text", "yaml"],
  ".yml": ["text", "yaml"],
  ".json": ["text", "json"],
  ".toml": ["text", "toml"],
  ".css": ["text", "css"],
  ".scss": ["text", "scss"],
  ".html": ["text", "html"],
  ".sh": ["text", "shell"],
  ".sql": ["text", "sql"],
  ".go": ["text", "go"],
  ".rs": ["text", "rust"],
  ".txt": ["text", "plain-text"],
}

export const KNOWN_TAGS: ReadonlySet<string> = new Set(["file", ...Object.values(TYPE_TABLE).flat()])

const FILE_ONLY: ReadonlySet<string> = new Set(["file"])

export function tagsOf(file: string): ReadonlySet<string> {
  const tags = TYPE_TABLE[path.posix.extname(file).toLowerCase()]
  return tags ? new Set(["file", ...tags]) : FILE_ONLY
}

export interface FileFilterInput {
  /** Regex searched in the repo-relative path. */
  files: string
  exclude: string
  /** All must match. */
  types: string[]
  /** At least one must match, unless empty. */
  typesOr: string[]
  /** None may match. */
  excludeTypes: string[]
}

export type FileFilter = (file: string) => boolean

function compileRegex(key: "files" | "exclude", source: string): RegExp | string {
  try {
    return new RegExp(source)
  } catch (error) {
    return `${key}: invalid regex: ${errorMessage(error)}`
  }
}

/** A diagnostic message instead of a filter when a regex does not compile or a tag is unknown. */
export function compileFilter(input: FileFilterInput): FileFilter | string {
  const files = compileRegex("files", input.files)
  if (typeof files === "string") return files
  const exclude = compileRegex("exclude", input.exclude)
  if (typeof exclude === "string") return exclude
  const unknown = [...input.types, ...input.typesOr, ...input.excludeTypes].find((tag) => !KNOWN_TAGS.has(tag))
  if (unknown !== undefined) return `unknown file type "${unknown}"`

  const { types, typesOr, excludeTypes } = input
  return (file) => {
    if (!files.test(file) || exclude.test(file)) return false
    const tags = tagsOf(file)
    return (
      types.every((tag) => tags.has(tag)) &&
      (typesOr.length === 0 || typesOr.some((tag) => tags.has(tag))) &&
      !excludeTypes.some((tag) => tags.has(tag))
    )
  }
}
