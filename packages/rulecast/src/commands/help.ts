import { VERSION } from "../core/version"

export interface CommandHelp {
  name: string
  synopsis: string
  /** One line, for `rulecast help`. */
  summary: string
  flags: [flag: string, text: string][]
}

/**
 * Every command, once. The usage text, each `<command> --help` and the README's command table are
 * all this list (test/commands/help.test.ts holds the README to it), so a flag cannot be documented
 * in one place and missing from another — which is how `test --against` came to be in the README and
 * absent from the usage.
 */
export const COMMANDS: CommandHelp[] = [
  {
    name: "init",
    synopsis:
      "rulecast init [--rules id,id | --no-rules] [--agent <name>... | --no-agents] [--scope shared|personal] [--yes]",
    summary: "Set rulecast up: config, catalog rules, agent hooks",
    flags: [
      ["--rules id,id", "Install these catalog rules instead of the ones that apply to your files"],
      ["--no-rules", "Install no catalog rules"],
      ["--agent <name>", "Install hooks for this agent (claude-code); repeatable"],
      ["--no-agents", "Install no agent hooks"],
      ["--scope shared|personal", "Write hooks to the shared or the personal settings file"],
      ["--yes", "Take every default and write without asking"],
    ],
  },
  {
    name: "install",
    synopsis: "rulecast install [--agent <name>]... [--scope shared|personal]",
    summary: "Add the agent hooks, or upgrade them, and fetch missing rule repos",
    flags: [
      ["--agent <name>", "Only this agent; repeatable. Default: every supported agent"],
      ["--scope shared|personal", "Write to the shared or the personal settings file"],
    ],
  },
  {
    name: "uninstall",
    synopsis: "rulecast uninstall [--agent <name>]...",
    summary: "Remove the agent hooks rulecast added",
    flags: [["--agent <name>", "Only this agent; repeatable"]],
  },
  {
    name: "run",
    synopsis:
      "rulecast run [RULE_ID] [--all-files | --files F...] [--from-ref A [--to-ref B]] [--summary] [--format terminal|agent|json|sarif] [--session <id>] [--llm | --no-llm]",
    summary: "Check staged files (the default), changed files, or everything",
    flags: [
      ["RULE_ID", "Run only this rule"],
      ["--all-files", "Every file git knows about, with the adoption backlog"],
      ["--files F...", "These files"],
      ["--from-ref A", "Files changed since the merge base with A, judged against it"],
      ["--to-ref B", "With --from-ref: up to B, read at B (pre-push, CI)"],
      ["--summary", "Print the backlog instead of every finding"],
      ["--format", "terminal, agent, json or sarif"],
      ["--session <id>", "The files an agent session edited, as at its Stop"],
      ["--llm", "Include metered (llm) rules in a staged run, which skips them by default"],
      ["--no-llm", "Skip metered (llm) rules in any run"],
    ],
  },
  {
    name: "list",
    synopsis: "rulecast list [--format terminal|json]",
    summary: "Show every configured rule: where it comes from, what it matches, what it cites",
    flags: [["--format", "terminal or json"]],
  },
  {
    name: "test",
    synopsis: "rulecast test [RULE_ID] [--against PATH...]",
    summary: "Run each rule's good/bad examples; --against says how much it would flag",
    flags: [
      ["RULE_ID", "Only this rule. Needed for llm rules, which cost money per example"],
      ["--against PATH...", "With RULE_ID: fire the rule over real files and count what it finds"],
    ],
  },
  {
    name: "validate",
    synopsis: "rulecast validate [file...]",
    summary: "Check the config (and a rules manifest) and print diagnostics",
    flags: [["file...", "A config (repos:) or a manifest (a list of rules), whatever its name"]],
  },
  {
    name: "doctor",
    synopsis: "rulecast doctor",
    summary: "Compile, check the environment and hooks, dry-run every rule",
    flags: [],
  },
  {
    name: "autoupdate",
    synopsis: "rulecast autoupdate [--freeze] [--repo URL]...",
    summary: "Move pinned rule repos to their latest tag",
    flags: [
      ["--freeze", "Pin the commit SHA, with the tag in a comment"],
      ["--repo URL", "Only this repo; repeatable"],
    ],
  },
  {
    name: "try-repo",
    synopsis: "rulecast try-repo <path|url> [RULE_ID] [--ref REV] [run flags]",
    summary: "Run a rule repo against your project without configuring it",
    flags: [["--ref REV", "The revision of a URL repo (default HEAD)"]],
  },
  {
    name: "clean",
    synopsis: "rulecast clean [--project]",
    summary: "Delete the cache",
    flags: [["--project", "Only this project's directory"]],
  },
  {
    name: "warm",
    synopsis: "rulecast warm [--detector <kind>]...",
    summary: "Build detector caches ahead of time",
    flags: [["--detector <kind>", "Only this detector kind; repeatable"]],
  },
  {
    name: "hook",
    synopsis: "rulecast hook <adapter>",
    summary: "Answer an agent hook on stdin (the agent runs this, not you)",
    flags: [],
  },
]

const NAME_WIDTH = Math.max(...COMMANDS.map((command) => command.name.length))

/** `rulecast`, `rulecast help`: what each command is for, one line each. */
export function usage(): string {
  return [
    `rulecast ${VERSION}`,
    "",
    "usage: rulecast <command> [flags]",
    "",
    ...COMMANDS.map((command) => `  ${command.name.padEnd(NAME_WIDTH)}  ${command.summary}`),
    "",
    "rulecast <command> --help shows a command's flags.",
    "",
  ].join("\n")
}

/** `rulecast <command> --help`: its synopsis, what it does and each flag. Null for an unknown command. */
export function commandHelp(name: string): string | null {
  const command = COMMANDS.find((candidate) => candidate.name === name)
  if (command === undefined) return null
  const width = Math.max(0, ...command.flags.map(([flag]) => flag.length))
  return [
    command.synopsis,
    "",
    command.summary,
    ...(command.flags.length === 0
      ? []
      : ["", ...command.flags.map(([flag, text]) => `  ${flag.padEnd(width)}  ${text}`)]),
    "",
  ].join("\n")
}
