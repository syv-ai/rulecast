import path from "node:path"

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
 * The command every shared Claude Code hook entry runs. Through `sh`, so the script needs no
 * executable bit, which a checkout does not always keep. settings.ts recognises it by the script's path.
 */
export const HOOK_COMMAND = `sh "$CLAUDE_PROJECT_DIR"/${HOOK_SCRIPT_FILE}`

/**
 * The command a personal-scope entry runs: the script by its absolute path. Claude Code reads
 * settings.local.json at the git top even when a session starts in a subdirectory, and sets
 * $CLAUDE_PROJECT_DIR to that subdirectory, where HOOK_COMMAND's path would not exist (exit 127 on
 * every event). The file is not committed, so a path of this machine's is safe in it.
 */
export function personalHookCommand(dir: string): string {
  return `sh '${path.join(dir, HOOK_SCRIPT_FILE).replaceAll("'", `'\\''`)}'`
}

/** The directory a personalHookCommand runs the script of; null for any other command. */
export function personalHookDir(command: string): string | null {
  const quoted = /^sh '(.*)'$/s.exec(command)
  if (quoted === null) return null
  const file = quoted[1]!.replaceAll(`'\\''`, "'")
  const suffix = `/${HOOK_SCRIPT_FILE}`
  return path.isAbsolute(file) && file.endsWith(suffix) ? file.slice(0, -suffix.length) : null
}

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

# The project: where install wrote this script, two directories up. Not $CLAUDE_PROJECT_DIR, which
# is where the session started and can be a directory below it.
case "$0" in
  */${HOOK_SCRIPT_FILE}) root=\${0%/${HOOK_SCRIPT_FILE}} ;;
  *) root=$CLAUDE_PROJECT_DIR ;;
esac

# 1. The project's own rulecast. A devDependency is a version the project committed to, so it wins
#    for everyone. It gets the payload on stdin untouched.
project_rulecast="$root/node_modules/.bin/rulecast"
if [ -x "$project_rulecast" ]; then
  exec "$project_rulecast" hook claude-code
fi

# 2. A linked worktree (claude --worktree) has no node_modules of its own: the main checkout's
#    rulecast. Found from the worktree's .git file and its git directory's commondir, read by the
#    shell: no git process. A submodule's git directory has no commondir, so it is left alone.
if [ -f "$root/.git" ]; then
  gitdir=
  IFS= read -r gitdir < "$root/.git"
  gitdir=\${gitdir#gitdir: }
  case "$gitdir" in "" | /*) ;; *) gitdir=$root/$gitdir ;; esac
  if [ -n "$gitdir" ] && [ -f "$gitdir/commondir" ]; then
    common=
    IFS= read -r common < "$gitdir/commondir"
    case "$common" in "" | /*) ;; *) common=$gitdir/$common ;; esac
    main_rulecast="$common/../node_modules/.bin/rulecast"
    if [ -n "$common" ] && [ -x "$main_rulecast" ]; then
      exec "$main_rulecast" hook claude-code
    fi
  fi
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

# 3. A rulecast on the PATH: install.sh's, or a global npm install.
if command -v rulecast >/dev/null 2>&1; then
  run_rulecast rulecast
fi

# 4. install.sh's rulecast in its install directory. An agent started from the Dock or an IDE may run
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
