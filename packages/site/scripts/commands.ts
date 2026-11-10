/**
 * The Commands page, built from the CLI's own help: `rulecast help --all` (without its version
 * line) and each command's `--help`, as recorded in HELP_DIR. A test in the CLI package holds
 * those files to the CLI's output, and the site reads them from the release it documents, so the
 * page shows that release's commands and flags and cannot drift from them.
 */
export const HELP_DIR = "packages/rulecast/test/snapshots/help"

interface Listed {
  name: string
  summary: string
  advanced: boolean
}

/** The commands `help --all` lists, in its order, and which are under its "Advanced:" heading. */
export function listedCommands(all: string): Listed[] {
  const listed: Listed[] = []
  let advanced = false
  for (const line of all.split("\n")) {
    if (line === "Advanced:") advanced = true
    const match = /^ {2}([a-z][a-z-]*) {2,}(.+)$/.exec(line)
    if (match) listed.push({ name: match[1]!, summary: match[2]!.trim(), advanced })
  }
  if (listed.length === 0) throw new Error(`${HELP_DIR}/all.txt lists no commands`)
  return listed
}

const cell = (text: string) => text.replaceAll("|", "\\|")

/** The page's Markdown: a table of every command, then each command's help under its own heading. */
/** `read` reads a repository file; sources.ts passes its readSource, which this module cannot import (it imports this one). */
export function commandsMarkdown(read: (file: string) => string): string {
  const commands = listedCommands(read(`${HELP_DIR}/all.txt`))
  const row = (command: Listed) => `| [\`${command.name}\`](#rulecast-${command.name}) | ${cell(command.summary)} |`
  const table = [
    "| Command | Does |",
    "|---|---|",
    ...commands.filter((command) => !command.advanced).map(row),
    "| **Advanced** | Most projects never run these by hand |",
    ...commands.filter((command) => command.advanced).map(row),
  ].join("\n")
  const sections = commands.map((command) => {
    // The summary is printed above the block, so it is left out of it.
    const help = read(`${HELP_DIR}/${command.name}.txt`)
      .split("\n")
      .filter((line) => line !== command.summary)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    return `## rulecast ${command.name}\n\n${command.summary}.\n\n\`\`\`text\n${help}\n\`\`\``
  })
  return [table, ...sections].join("\n\n")
}
