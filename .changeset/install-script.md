---
"@syv-ai/rulecast": minor
---

The standalone binary installs with one command, the way uv's installer works:

```sh
curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh
```

- In a terminal, `install.sh` first shows what it will do and asks: proceed, customize (the directory, and whether to change startup files) or cancel. It reads the terminal, so it asks under `curl … | sh` too. With no terminal (CI, an agent, a container build) it uses the defaults and says so. Options go after `sh -s --`: `-y`/`--yes`, `--install-dir DIR`, `--no-modify-path`, `--help`; `RULECAST_YES=1`, `RULECAST_INSTALL_DIR` and `RULECAST_NO_MODIFY_PATH=1` do the same.
- It downloads this machine's binary and its `.sha256` from the release, checks one against the other, and installs it as `~/.local/bin/rulecast`. `RULECAST_INSTALL_DIR` picks another directory, and so does `XDG_BIN_HOME` when `RULECAST_INSTALL_DIR` is unset.
- It puts that directory on the PATH: it writes `<dir>/env` and sources it from `~/.profile`, from `~/.bashrc` and `~/.bash_profile` if they exist, and from `~/.zshrc` if it exists or zsh is your shell. It prints every file it changes. `RULECAST_NO_MODIFY_PATH=1` changes none. In GitHub Actions it also adds the directory to `$GITHUB_PATH`.
- The docs site serves the latest release's script. Each release carries its own copy for a fixed version: `https://github.com/syv-ai/rulecast/releases/download/vX.Y.Z/install.sh`.
- Git hooks and agent hooks run the project's `node_modules/.bin/rulecast`, else `rulecast` on the PATH, else install.sh's in its directory: an agent started from the Dock or an IDE may run its hooks with a PATH that lacks it.

Breaking changes:

- The binary no longer lives in the cache home. Run the install command again, then delete `~/.cache/rulecast/bin`.
- `rulecast binary` (`install` and `path`) is removed.
- The hooks no longer look in the cache home. Run `rulecast install` to rewrite the agent hooks, and replace the git hook commands with the ones in the Git hooks guide.
- `rulecast clean` keeps only this version's native files. `doctor`'s install advice and the not-installed messages have changed.
- Nothing warms the ast-grep parsers after installing: the first edit with a new version unpacks them.
