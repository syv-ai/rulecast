---
"@syv-ai/rulecast": minor
---

The standalone binary is an install option for agent hooks. It needs no Node, no devDependency and no global npm install. You install it yourself; nothing downloads or installs it for you.

- `rulecast binary install`, run by a downloaded binary, puts it at `<cache home>/bin/<version>/rulecast` and points `<cache home>/bin/rulecast` at it. `rulecast binary path` names the current one. Under Node, `binary install` prints the command that installs the binary and installs nothing.
- The README's Install section has a one-line install command. It downloads this version's binary and its `.sha256` from Releases, checks them, and only then runs `binary install`.
- The binary unpacks ast-grep's native module once, into `<cache home>/native/`, instead of to a new temp path on every run. On macOS that took a TypeScript ast-grep run from about 630 ms to about 105 ms.
- The binary can start `rulecast warm`. Before, the child it started failed with `unknown command "/$bunfs/root/rulecast"`.
- `doctor` says which rulecast the hooks run and its version. When that version is older than `minimum_rulecast_version`, it warns and prints the update command. When the project's rulecast and an installed binary differ, it names both.
- "requires rulecast X or newer" now names the rulecast that ran.
- Setup asks how to install rulecast, recommends the binary (or the devDependency when the project pins its tools in `package.json`), shows the exact command, and runs it only after approval.

Breaking changes:

- The agent hook command looks in the project's `node_modules/.bin`, then the installed binary, then the PATH. Existing hooks read as out of date in `doctor`; run `rulecast install` to rewrite them.
- The not-installed messages (`NOT_INSTALLED`, `NOT_INSTALLED_UNATTENDED`) have new text.
- The `.pre-commit-hooks.yaml` entries no longer run `npx --no-install rulecast`. They use the same lookup as the agent hooks, so git hooks need no Node.
- The README's Install section and lefthook snippet changed to match. The binary is no longer "for CI and one-off runs".
- `cacheHome()` reads `HOME` from the environment it is given before falling back to the OS home directory.
