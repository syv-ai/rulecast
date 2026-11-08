---
name: setup
description: Sets rulecast up in a project with the developer: finds what the repository can tell, asks the rest, shows one page with the agreed setup, and writes it once the developer approves. Use when the developer asks to set up, install, configure or start using rulecast, or when /rulecast:add-rule finds no rulecast config.
argument-hint: "[anything the developer already said about how they want to use it]"
---

# Set up rulecast

The developer asked to set rulecast up. They said: $ARGUMENTS

Setting rulecast up is a conversation with the developer: they decide every choice, and nothing is written until they approve. If they are not here, stop and say so.

Read [SETUP.md](https://raw.githubusercontent.com/syv-ai/rulecast/v0.8.2/agents/SETUP.md) and follow it. What the developer said above answers some of its questions: say how you read it, and don't ask those again.

Commands there say `rulecast`. If `rulecast` is not on the PATH, use this machine's installed binary, `~/.cache/rulecast/bin/rulecast-<platform>-<arch>` (such as `rulecast-darwin-arm64`), if it exists, else `npx @syv-ai/rulecast`.
