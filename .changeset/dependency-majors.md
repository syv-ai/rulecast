---
"@syv-ai/rulecast": minor
---

Updates the libraries rulecast runs on to their current major versions: `zod` 4, which checks config files, and `diff` 9, which compares files. Config error messages keep their wording, though a config with several errors may list them in a different order.

Things you may notice:

- `rulecast fix --dry-run` now puts a file name containing a tab, newline or carriage return in quotes, the way git writes it, so `git apply` can read the diff. Other names are not quoted, so `å.ts` still applies with macOS's `patch`, which reads no quoted names.
- A whole number above 2^53 in a config, such as `max_file_bytes: 1e21`, is now refused instead of accepted.
- Breaking, for anyone writing a custom detector: its `schema` must now be built with zod 4, because rulecast's types and validation use it.
- Two exported types loosened from a non-empty tuple to an array: `RuleExamples`' `expect.lines` and `RuleEntry.stages` in `/internal`.

The package's type declarations are now one file per module rather than a single bundle, because TypeScript 7 cannot bundle them. Importing from `@syv-ai/rulecast` works the same. zod 4 takes about 30 ms longer to load in each rulecast process. On Node 22.1 or newer rulecast now turns on Node's compile cache, kept in the system's temp directory, which wins back about half of that; on Node 20 hooks are the full 30 ms slower.
