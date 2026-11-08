#!/bin/sh
# rulecast's Claude Code hook. Every rulecast entry in .claude/settings.json runs this script,
# with the event's JSON payload on stdin.
#
# Written by `rulecast install`. Don't edit it: re-run `rulecast install` to update it, and
# `rulecast doctor` says when it is out of date.
#
# It only looks for a rulecast to run. It never downloads or installs anything.

# 1. The project's own rulecast. A devDependency is a version the project committed to, so it wins
#    for everyone. It gets the payload on stdin untouched.
project_rulecast="$CLAUDE_PROJECT_DIR/node_modules/.bin/rulecast"
if [ -x "$project_rulecast" ]; then
  exec "$project_rulecast" hook claude-code
fi

# Past here the payload is read once, so each rulecast tried can be given it.
payload=$(cat)

# Runs the rulecast named by $1 with the payload, and exits with its status. 126 and 127 are the
# shell's "could not run it" (a binary built for another machine, or a version-manager shim with no
# rulecast behind it): that counts as no rulecast, and the lookup goes on.
run_rulecast() {
  printf '%s' "$payload" | "$1" hook claude-code
  status=$?
  if [ "$status" -ne 126 ] && [ "$status" -ne 127 ]; then
    exit "$status"
  fi
}

# 2. A rulecast on the PATH: install.sh's, or a global npm install.
if command -v rulecast >/dev/null 2>&1; then
  run_rulecast rulecast
fi

# 3. install.sh's rulecast in its install directory. An agent started from the Dock or an IDE may run
#    hooks with a PATH that never read the shell's startup files, where install.sh put it.
installed_rulecast="${RULECAST_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}/rulecast"
if [ -x "$installed_rulecast" ]; then
  run_rulecast "$installed_rulecast"
fi

# No rulecast to run. Exit 0 either way, so no hook fails; the user is told at the start of a
# session, and an unattended run at every stop, since nobody reads the start in a loop.

# Unattended as the shell sees it, as rulecast resolves it: RULECAST_MODE, else CI or GITHUB_ACTIONS
# set and not false or 0. The config's mode: is out of reach here.
unattended=
case "$CI" in "" | false | 0) ;; *) unattended=1 ;; esac
case "$GITHUB_ACTIONS" in "" | false | 0) ;; *) unattended=1 ;; esac
case "$RULECAST_MODE" in
  unattended) unattended=1 ;;
  attended | interactive) unattended= ;;
esac

# True when the payload's hook_event_name matches the extended regex $1.
event_is() {
  printf '%s' "$payload" | grep -qE '"hook_event_name": *"('"$1"')"'
}

if event_is SessionStart; then
  printf '%s' '{"systemMessage":"rulecast is configured in this project but not installed. Install it (curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh) or add @syv-ai/rulecast to the project (pnpm add -D), then run rulecast doctor."}'
elif [ -n "$unattended" ] && event_is '(Subagent)?Stop'; then
  printf '%s' '{"systemMessage":"rulecast is configured in this project but not installed: no rules ran this session. Install rulecast before starting the agent: npm ci (or pnpm install), or curl -LsSf https://syv-ai.github.io/rulecast/install.sh | sh."}'
fi
exit 0
