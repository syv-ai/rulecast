import { closeSync, lstatSync, openSync, readSync } from "node:fs"
import path from "node:path"

import { errorMessage } from "./errors"

/**
 * Extension (lowercase, with the dot) → file-type tags, after pre-commit's identify (2.6.15): each
 * extension identify gives one of rulecast's tags, with the tags of rulecast's it gives (`text`
 * only beside another). rulecast also counts `.mts` and `.cts` as `ts`, and `.pyi` as `python`.
 * Every file also has "file".
 */
export const TYPE_TABLE: Readonly<Record<string, readonly string[]>> = {
  ".bash": ["text", "shell"],
  ".bats": ["text", "shell"],
  ".cjs": ["text", "javascript"],
  ".csh": ["text", "shell"],
  ".css": ["text", "css"],
  ".cts": ["text", "ts"],
  ".ejson": ["text", "json"],
  ".eyaml": ["text", "yaml"],
  ".geojson": ["text", "json"],
  ".go": ["text", "go"],
  ".gyp": ["text", "python"],
  ".gypi": ["text", "python"],
  ".htm": ["text", "html"],
  ".html": ["text", "html"],
  ".ipynb": ["text", "json"],
  ".js": ["text", "javascript"],
  ".json": ["text", "json"],
  ".jsonld": ["text", "json"],
  ".jsx": ["text", "jsx"],
  ".markdown": ["text", "markdown"],
  ".md": ["text", "markdown"],
  ".mdx": ["text", "mdx"],
  ".mjs": ["text", "javascript"],
  ".mts": ["text", "ts"],
  ".piskel": ["text", "json"],
  ".py": ["text", "python"],
  ".pyi": ["text", "python", "pyi"],
  ".pyt": ["text", "python"],
  ".rs": ["text", "rust"],
  ".scss": ["text", "scss"],
  ".sh": ["text", "shell"],
  ".sql": ["text", "sql"],
  ".tac": ["text", "python"],
  ".toml": ["text", "toml"],
  ".ts": ["text", "ts"],
  ".tsx": ["text", "tsx"],
  ".txt": ["text", "plain-text"],
  ".wsgi": ["text", "python"],
  ".xctestplan": ["text", "json"],
  ".xhtml": ["text", "html"],
  ".yaml": ["text", "yaml"],
  ".yamlld": ["text", "yaml"],
  ".yml": ["text", "yaml"],
  ".zsh": ["text", "shell"],
}

/**
 * File names identify (2.6.15) types, with the tags of rulecast's it gives them. Every name identify
 * knows is here, even with none of rulecast's tags: as in identify, the first part of a name that is
 * one decides, and a file with a known name or extension has no shebang read.
 */
const NAME_TABLE: Readonly<Record<string, readonly string[]>> = {
  ".ansible-lint": ["text", "yaml"],
  ".babelrc": ["text", "json"],
  ".bash_aliases": ["text", "shell"],
  ".bash_profile": ["text", "shell"],
  ".bashrc": ["text", "shell"],
  ".bazelrc": [],
  ".bowerrc": ["text", "json"],
  ".browserslistrc": [],
  ".clang-format": ["text", "yaml"],
  ".clang-tidy": ["text", "yaml"],
  ".codespellrc": [],
  ".coveragerc": [],
  ".cshrc": ["text", "shell"],
  ".csslintrc": ["text", "json"],
  ".dockerignore": [],
  ".editorconfig": [],
  ".envrc": ["text", "shell"],
  ".flake8": [],
  ".gitattributes": [],
  ".gitconfig": [],
  ".gitignore": [],
  ".gitlint": [],
  ".gitmodules": [],
  ".hgrc": [],
  ".isort.cfg": [],
  ".jshintrc": ["text", "json"],
  ".mailmap": [],
  ".mention-bot": ["text", "json"],
  ".npmignore": [],
  ".pdbrc": ["text", "python"],
  ".prettierignore": [],
  ".pypirc": [],
  ".rstcheck.cfg": [],
  ".salt-lint": ["text", "yaml"],
  ".sqlfluff": [],
  ".yamllint": ["text", "yaml"],
  ".zlogin": ["text", "shell"],
  ".zlogout": ["text", "shell"],
  ".zprofile": ["text", "shell"],
  ".zshenv": ["text", "shell"],
  ".zshrc": ["text", "shell"],
  AUTHORS: ["text", "plain-text"],
  "bblayers.conf": [],
  "bitbake.conf": [],
  BUILD: [],
  "Cargo.lock": ["text", "toml"],
  "Cargo.toml": ["text", "toml"],
  CHANGELOG: ["text", "plain-text"],
  "CMakeLists.txt": [],
  "config.ru": [],
  Containerfile: [],
  CONTRIBUTING: ["text", "plain-text"],
  "copy.bara.sky": [],
  COPYING: ["text", "plain-text"],
  direnvrc: ["text", "shell"],
  Dockerfile: [],
  Gemfile: [],
  "Gemfile.lock": [],
  GNUmakefile: [],
  "go.mod": [],
  "go.sum": [],
  Jenkinsfile: [],
  LICENSE: ["text", "plain-text"],
  MAINTAINERS: ["text", "plain-text"],
  Makefile: [],
  makefile: [],
  "meson.build": [],
  "meson.options": [],
  "meson_options.txt": [],
  NEWS: ["text", "plain-text"],
  NOTICE: ["text", "plain-text"],
  PATENTS: ["text", "plain-text"],
  Pipfile: ["text", "toml"],
  "Pipfile.lock": ["text", "json"],
  PKGBUILD: ["text", "shell"],
  "poetry.lock": ["text", "toml"],
  "pom.xml": [],
  pylintrc: [],
  Rakefile: [],
  README: ["text", "plain-text"],
  "rebar.config": [],
  "setup.cfg": [],
  "sys.config": [],
  "sys.config.src": [],
  Tiltfile: [],
  Vagrantfile: [],
  WORKSPACE: [],
  wscript: ["text", "python"],
}

export const KNOWN_TAGS: ReadonlySet<string> = new Set(["file", ...Object.values(TYPE_TABLE).flat()])

const FILE_ONLY: ReadonlySet<string> = new Set(["file"])

/**
 * A file's tags from its path, as identify's tags_from_filename: the first part of its name
 * ("README" in README.md) that is a known file name, and its extension. `known`: identify knows
 * either, so it reads no shebang.
 */
function pathTags(file: string): { tags: ReadonlySet<string>; known: boolean } {
  const name = path.posix.basename(file)
  const tags = new Set(["file"])
  let known = false
  for (const part of [name, ...name.split(".")]) {
    const named = NAME_TABLE[part]
    if (named === undefined || !Object.hasOwn(NAME_TABLE, part)) continue
    for (const tag of named) tags.add(tag)
    known = true
    break
  }
  const extension = path.posix.extname(name).toLowerCase()
  const byExtension = Object.hasOwn(TYPE_TABLE, extension) ? TYPE_TABLE[extension] : undefined
  if (byExtension !== undefined) for (const tag of byExtension) tags.add(tag)
  // rulecast's own .mts and .cts don't stop a shebang being read: identify doesn't know them.
  if (IDENTIFY_EXTENSIONS.has(extension.slice(1))) known = true
  return { tags: tags.size === 1 ? FILE_ONLY : tags, known }
}

/** A file's tags from its path alone: its name and extension. */
export function tagsOf(file: string): ReadonlySet<string> {
  return pathTags(file).tags
}

/** Interpreters identify (2.6.15) knows, by the tags of rulecast's they give; pypy is rulecast's own. */
const INTERPRETERS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    ["ash", "bash", "bats", "cbsd", "csh", "dash", "ksh", "sh", "tcsh", "zsh"].map((name) => [name, "shell"]),
  ),
  node: "javascript",
  nodejs: "javascript",
  python: "python",
  python2: "python",
  python3: "python",
  pypy: "python",
  pypy3: "python",
}

/**
 * Every extension identify (2.6.15) types a file by, whether or not rulecast has a type for it: a
 * file with one of these has no shebang read, as in identify (deploy.rb is ruby, never shell).
 */
const IDENTIFY_EXTENSIONS: ReadonlySet<string> = new Set(
  (
    "adoc ai aj apinotes asar asciidoc asm astro avif avsc bash bat bats bazel bb bbappend bbclass " +
    "beancount bib bmp bz2 bz3 bzl c c++ c++m cc ccm cfg chs cjs clj cljc cljs cmake cnf coffee conf " +
    "cpp cppm cr crt cs csh cson csproj css csv csx cu cue cuh cxx cxxm cylc dart dbc def dll dtd ear " +
    "edn ejs ejson elm env eot eps erb erl ex exe exs eyaml f03 f08 f90 f95 feature fish fits fs " +
    "fsproj fsx gd gemspec geojson ggb gif gleam go gotmpl gpx gradle graphql groovy gyb gyp gypi gz " +
    "h hbs hcl hh hpp hrl hs htm html hxx icns ico ics idl idr inc ini inl ino inx ipp ipynb ixx j2 " +
    "jade jar java jenkins jenkinsfile jinja jinja2 jl jpeg jpg js json json5 jsonld jsonnet jsx key " +
    "kml kt kts lean lektorproject less lfm lhs libsonnet lidr liquid lpi lpr lr lua m m4 magik make " +
    "manifest map markdown md mdx meson metal mib mjs mk ml mli mm modulemap mscx mscz mustache myst " +
    "ngdoc nim nimble nims nix njk otf p12 pas patch pdf pem php php4 php5 phtml piskel pl plantuml " +
    "plist pm png po pom pp ppm prisma properties props proto ps1 psd1 psm1 pug puml purs pxd pxi py " +
    "pyi pyproj pyt pyx pyz pyzw qml r rake rb resx rng robot rs rst s sas sass sbt sc scala scm scss " +
    "sh sln sls so sol spec sql ss sty styl sv svelte svg svh swf swift swiftdeps tac tar targets " +
    "templ tex textproto tf tfvars tgz thrift tiff toml tpp ts tsv tsx ttf twig txsprofile txt txtpb " +
    "urdf v vb vbproj vcxproj vdx vh vhd vim vtl vue war wav webp whl wkt woff woff2 wsdl wsgi xacro " +
    "xctestplan xhtml xml xq xql xqm xqu xquery xqy xsd xsl xslt yaml yamlld yang yin yml zcml zig " +
    "zip zpt zsh"
  ).split(" "),
)

/** How many bytes of a file are read for its shebang: the interpreter comes first on its line. */
const SHEBANG_BYTES = 256
/** nix-shell names the interpreter on a later `#!` line: that much more is read for it. */
const NIX_SHELL_BYTES = 4096

const tagCache = new Map<string, ReadonlySet<string>>()
let reads = 0

/** Shebang reads this process made (a test's measure), and a fresh cache. */
export const shebangReads = () => reads
export function clearShebangCache(): void {
  tagCache.clear()
  reads = 0
}

function readHead(absolute: string, bytes: number): string {
  reads++
  const buffer = Buffer.alloc(bytes)
  const fd = openSync(absolute, "r")
  try {
    return buffer.subarray(0, readSync(fd, buffer, 0, bytes, 0)).toString("utf8")
  } finally {
    closeSync(fd)
  }
}

/**
 * A shebang line split as identify splits it: as a POSIX shell would (shlex), so a quoted path
 * with a space is one word; past an unclosed quote, on whitespace.
 */
function shebangSplit(line: string): string[] {
  const words: string[] = []
  let word = ""
  let inWord = false
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (quote === "'") {
      if (char === "'") quote = null
      else word += char
    } else if (quote === '"') {
      if (char === '"') quote = null
      else if (char === "\\" && /["\\$`\n]/.test(line[i + 1] ?? "")) word += line[++i]
      else word += char
    } else if (/\s/.test(char)) {
      if (inWord) words.push(word)
      word = ""
      inWord = false
    } else if (char === "'" || char === '"') {
      quote = char
      inWord = true
    } else if (char === "\\") {
      if (i + 1 >= line.length) return line.split(/\s+/).filter((one) => one !== "")
      word += line[++i]
      inWord = true
    } else {
      word += char
      inWord = true
    }
  }
  if (quote !== null) return line.split(/\s+/).filter((one) => one !== "")
  if (inWord) words.push(word)
  return words
}

/**
 * The tag a script's shebang gives it, as identify's parse_shebang reads it: `#!/usr/bin/env [-S]
 * x` names x, nix-shell names the interpreter after `-i` on a later `#!` line, and a versioned name
 * such as python3.12 is tried as python3.12, then python3.
 */
function shebangTag(absolute: string): string | null {
  let head = readHead(absolute, SHEBANG_BYTES)
  if (!head.startsWith("#!")) return null
  const lines = () => head.split(/\r?\n/)
  let command = shebangSplit(lines()[0]!.slice(2).trim())
  if (/(^|\/)env$/.test(command[0] ?? "")) command = command[1] === "-S" ? command.slice(2) : command.slice(1)
  if (command.length === 1 && command[0] === "nix-shell") {
    head = readHead(absolute, NIX_SHELL_BYTES)
    for (const line of lines().slice(1)) {
      if (!line.startsWith("#!")) break
      const tokens = shebangSplit(line.slice(2).trim())
      for (let i = 0; i < tokens.length - 1; i++) if (tokens[i] === "-i") command = [tokens[i + 1]!]
    }
  }
  let name = (command[0] ?? "").split("/").at(-1)!
  while (name !== "") {
    if (Object.hasOwn(INTERPRETERS, name)) return INTERPRETERS[name]!
    const dot = name.lastIndexOf(".")
    name = dot === -1 ? "" : name.slice(0, dot)
  }
  return null
}

/**
 * A file's tags as identify gives them, for the file at `root`/`file`: none but `file` for a
 * symlink (identify gives it only `symlink`); from its path when identify knows its name or
 * extension; else, when it is executable, from its shebang. A file that is not there (deleted, not
 * written yet) is typed by its path. Once per path in a process.
 */
export function tagsAt(root: string, file: string): ReadonlySet<string> {
  const absolute = path.resolve(root, file)
  const cached = tagCache.get(absolute)
  if (cached !== undefined) return cached
  const own = pathTags(file)
  let tags = own.tags
  try {
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) tags = FILE_ONLY
    else if (!own.known && stat.isFile() && (stat.mode & 0o111) !== 0) {
      const tag = shebangTag(absolute)
      if (tag !== null) tags = new Set([...own.tags, tag])
    }
  } catch {
    // Not there, or not readable: its path says what it is.
  }
  tagCache.set(absolute, tags)
  return tags
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
  /**
   * The directory the paths are relative to: a file whose name and extension give no type then has
   * its shebang read, when the filter has type tags. Absent: tags come from the path alone.
   */
  root?: string
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

  const { types, typesOr, excludeTypes, root } = input
  const typed = types.some((tag) => tag !== "file") || typesOr.length > 0 || excludeTypes.length > 0
  return (file) => {
    if (!files.test(file) || exclude.test(file)) return false
    if (!typed) return true
    const tags = root === undefined ? tagsOf(file) : tagsAt(root, file)
    return (
      types.every((tag) => tags.has(tag)) &&
      (typesOr.length === 0 || typesOr.some((tag) => tags.has(tag))) &&
      !excludeTypes.some((tag) => tags.has(tag))
    )
  }
}
