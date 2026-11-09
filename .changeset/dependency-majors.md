---
"@syv-ai/rulecast": patch
---

Updates the libraries rulecast runs on to their current major versions: `zod` 4, which checks config files, and `diff` 9, which compares files. Config error messages read as before.

Three things you may notice:

- `rulecast fix --dry-run` now writes file names with special characters the way git does, so `å.ts` appears as `"a/\303\245.ts"` in the diff header. Ordinary names are unchanged.
- A whole number above 2^53 in a config, such as `max_file_bytes: 1e21`, is now refused instead of accepted.
- A custom detector's `schema` must now be built with zod 4, because rulecast's types and validation use it.

The package's type declarations are now one file per module rather than a single bundle, because TypeScript 7 cannot bundle them. Importing from `@syv-ai/rulecast` works the same. Each rulecast process starts about 30 ms slower, because zod 4 takes longer to load.
