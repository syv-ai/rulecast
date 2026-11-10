---
"@syv-ai/rulecast": patch
---

Fixes to how rulecast's agent hooks are installed and checked, to the standalone installer, and to `rulecast fix --dry-run`.

- `rulecast install` (and `rulecast init`) can put rulecast's Claude Code hooks in the shared `.claude/settings.json` or the personal `.claude/settings.local.json`. When both files held hooks from an older rulecast, only the shared one was updated, so the personal one kept the old commands and rulecast ran twice on every event. Install now updates rulecast's hooks in every settings file that has them, says which files it changed, and leaves everything else in those files alone. `rulecast doctor` reports a settings file left on an older command as out of date. Because install and init now read every settings file, one that is not valid JSON makes them stop and name it, where before they could skip it; doctor reports it on the hooks line and carries on.
- When the hooks are installed but no rulecast can be found to run them, `rulecast doctor` now says that first, with how to install rulecast, even when the hooks are also out of date. Before, it only said to run `rulecast install`, which does not fix it.
- `rulecast doctor` names the rulecast the hooks run more accurately. The binary from install.sh is called that whether or not it was found through the PATH, and it is never offered a global npm update. When a global npm rulecast comes before install.sh's directory on the PATH, doctor now says to update the npm install, since a newer install.sh binary would never run.
- install.sh prints the `fish_add_path` command with the directory in quotes, so a directory with a space in it stays one argument when you paste the command.
- install.sh treats `/x/y`, `/x/y/` and `/x/y//` as the same install directory, and a PATH entry with a trailing slash as the same directory too. It no longer adds a second line to your shell's startup files, or the directory to your PATH twice, when the spelling differs.
- `rulecast fix --dry-run` ends a file name that contains a space with a tab in the diff header, as git does. Without it, `patch` read `my file.ts` as `my` and could not apply the diff.
- `rulecast init` now tells you to commit the hook script (`.claude/hooks/rulecast.sh`) whenever the shared `.claude/settings.json` runs it, including when the hooks were found in your personal settings, and when the script is on disk but was never committed. Without it in the repository, every teammate's hooks fail.
