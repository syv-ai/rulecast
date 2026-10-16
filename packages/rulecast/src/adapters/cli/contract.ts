/**
 * What a loop or CI job may rely on from the CLI (agents/reference/output.md): the JSON document's
 * versions and the exit codes. Kept apart from the formatters so every command that prints a
 * document stamps its version from one place, and the help text and the README are held to the
 * same codes.
 */

/**
 * `schemaVersion` of the JSON document `run` and `try-repo` print. Adding a field leaves it alone;
 * removing one, renaming one or changing what one means bumps it.
 */
export const SCHEMA_VERSION = 1

/**
 * `schemaVersion` of `rulecast test --format json`, under the same policy. Its own number: the test
 * document has nothing in common with the run report, and one changing must not bump the other.
 */
export const TEST_SCHEMA_VERSION = 1

/**
 * `schemaVersion` of `rulecast stats --format json`: a different document from `run`'s, so its
 * own version, with the same policy.
 */
export const STATS_SCHEMA_VERSION = 1

/** `rulecast run` and `try-repo`. Other commands use 2 for whatever they found wrong. */
export const EXIT = {
  /** Every rule ran, and no new finding is an error. */
  clean: 0,
  /** Every rule ran, and at least one new finding is an error. */
  violations: 1,
  /** rulecast could not run: a usage error, a config file that does not load, git, or a crash. Nothing on stdout. */
  failed: 2,
  /** Some rules did not run. The findings of the rest are still printed; wins over 1. */
  incomplete: 3,
} as const

/** The table `run --help` prints, and the README's exit-code table is tested against. */
export const EXIT_CODES: [code: number, meaning: string][] = [
  [EXIT.clean, "Every rule ran; no new error-severity findings (warnings and pre-existing findings allowed)"],
  [EXIT.violations, "Every rule ran; at least one new error-severity finding"],
  [EXIT.failed, "rulecast could not run: usage, a config file that does not load, git, or an internal error"],
  [
    EXIT.incomplete,
    "Incomplete: a rule failed to compile, a rule repo could not be fetched, a detector failed or timed out. Findings that were produced are still reported. Wins over 1",
  ],
]
