---
"@syv-ai/rulecast": minor
---

The installer changes a shell startup file only in a terminal, for the default directory (`~/.local/bin` or `$XDG_BIN_HOME`). With no terminal (CI, an agent, a container build), or with a directory you name (`--install-dir`, `RULECAST_INSTALL_DIR`), it changes none and prints the line to add. Before, an agent installing into a scratch directory put that directory on the PATH in `~/.profile` and `~/.zshrc`. The new `--modify-path` (`RULECAST_MODIFY_PATH=1`) asks for the edit anyway; `--no-modify-path` still turns it off, and the last of the two wins. Breaking for scripted installs that relied on the edit: add `--modify-path`.
