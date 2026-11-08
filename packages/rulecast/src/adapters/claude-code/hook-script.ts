import { INSTALL_COMMAND, INSTALLED_SH } from "../../core/binary-home"

/**
 * What the user sees, once per session, when the project's hooks are committed and rulecast is not
 * installed yet — a fresh clone before `npm install`. Every other event says nothing.
 */
export const NOT_INSTALLED = `rulecast is configured in this project but not installed. Install it (${INSTALL_COMMAND}) or add @syv-ai/rulecast to the project (pnpm add -D), then run rulecast doctor.`

/**
 * What every stop says when rulecast is not installed and the run is unattended as the shell can
 * see it (#29): nobody reads the SessionStart message in a loop, and "no findings" is not "checked".
 */
export const NOT_INSTALLED_UNATTENDED = `rulecast is configured in this project but not installed: no rules ran this session. Install rulecast before starting the agent: npm ci (or pnpm install), or ${INSTALL_COMMAND}.`

/** Where install writes the script, relative to the settings' directory, which is $CLAUDE_PROJECT_DIR. */
export const HOOK_SCRIPT_FILE = ".claude/hooks/rulecast.sh"

/**
 * The command every Claude Code hook entry runs. Through `sh`, so the script needs no executable
 * bit, which a checkout does not always keep. settings.ts recognises it by the script's path.
 */
export const HOOK_COMMAND = `sh "$CLAUDE_PROJECT_DIR"/${HOOK_SCRIPT_FILE}`

/**
 * The hook script. A command naming a rulecast that is not there exits 127, which Claude Code shows
 * as a hook error on every Read and Edit (recorded in test/payloads/claude-code/README.md): a clone
 * before `npm install`, or a setup run through npx with nothing installed (plan 21). So the script
 * looks for one, and with none it exits 0. Never a block: without session state it could not hold
 * the agent only once per prompt.
 *
 * It carries no version, so it changes only when its logic does. The messages sit inside single
 * quotes, so neither may contain one.
 */
export const HOOK_SCRIPT = `#!/bin/sh
# rulecast's Claude Code hook. Every rulecast entry in .claude/settings.json runs this script,
# with the event's JSON payload on stdin.
#
# Written by \`rulecast install\`. Don't edit it: re-run \`rulecast install\` to update it, and
# \`rulecast doctor\` says when it is out of date.
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
installed_rulecast=${INSTALLED_SH}
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
  printf '%s' '${JSON.stringify({ systemMessage: NOT_INSTALLED })}'
elif [ -n "$unattended" ] && event_is '(Subagent)?Stop'; then
  printf '%s' '${JSON.stringify({ systemMessage: NOT_INSTALLED_UNATTENDED })}'
fi
exit 0
`
