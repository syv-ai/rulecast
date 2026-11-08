---
"@syv-ai/rulecast": minor
---

The standalone binary installs with one command, the way uv's installer works:

```sh
curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh
```

- `install.sh` downloads this machine's binary and its `.sha256` from the release, checks one against the other, and installs it as `~/.local/bin/rulecast`. `RULECAST_INSTALL_DIR` picks another directory, and so does `XDG_BIN_HOME` when `RULECAST_INSTALL_DIR` is unset.
- It puts that directory on the PATH: it writes `<dir>/env` and sources it from `~/.profile`, from `~/.bashrc` and `~/.bash_profile` if they exist, and from `~/.zshrc` if it exists or zsh is your shell. It prints every file it changes. `RULECAST_NO_MODIFY_PATH=1` changes none. In GitHub Actions it also adds the directory to `$GITHUB_PATH`.
- The docs site serves the latest release's script. Each release carries its own copy for a fixed version: `https://github.com/syv-ai/rulecast/releases/download/vX.Y.Z/install.sh`.
- Git hooks and agent hooks run the project's `node_modules/.bin/rulecast`, else `rulecast` on the PATH. The lefthook and pre-commit command is now `sh -c '[ -x ./node_modules/.bin/rulecast ] && exec ./node_modules/.bin/rulecast run; exec rulecast run' --`.
- `rulecast doctor` says when the install directory holds a rulecast that is not on the PATH the hooks run with.

Breaking changes:

- The binary no longer lives in the cache home. Run the install command again, then delete `~/.cache/rulecast/bin`.
- `rulecast binary` (`install` and `path`) is removed.
- The hooks no longer look in the cache home. Run `rulecast install` to rewrite the agent hooks, and replace the git hook commands with the ones in the Git hooks guide.
- `rulecast clean` keeps only this version's native files. `doctor`'s install advice and the not-installed messages have changed.
- Nothing warms the ast-grep parsers after installing: the first edit with a new version unpacks them.
